/* ========================================================================
   ANIMATED ERP DROPDOWNS
   Replaces native option popups with an accessible animated panel while the
   original select remains the real data source for all existing ERP logic.
   ======================================================================== */
(() => {
  const selectStates = new WeakMap();
  const wrapperStates = new WeakMap();
  const nativeValueDescriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
  const searchableSelectIds = new Set(["dCoSelect", "readyPalletDropdown", "reworkPalletDropdown"]);

  const closeAll = (except = null) => {
    document.querySelectorAll(".erp-select.open").forEach(wrapper => {
      if (wrapper !== except) {
        wrapper.classList.remove("open");
        const state = wrapperStates.get(wrapper);
        if (state?.searchable) state.sync();
      }
    });
  };

  const installValueSync = (select, sync) => {
    if (!nativeValueDescriptor) return;
    Object.defineProperty(select, "value", {
      configurable: true,
      get() { return nativeValueDescriptor.get.call(this); },
      set(nextValue) {
        nativeValueDescriptor.set.call(this, nextValue);
        queueMicrotask(() => sync());
      }
    });
  };

  const enhanceSearchableSelect = select => {
    select.dataset.erpSelectReady = "true";
    const wrapper = document.createElement("div");
    wrapper.className = "erp-select erp-select-searchable";
    select.parentNode.insertBefore(wrapper, select);
    wrapper.appendChild(select);
    select.classList.add("erp-select-native");

    const control = document.createElement("div");
    control.className = "erp-select-search-control";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "erp-select-search-input";
    input.autocomplete = "off";
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-expanded", "false");
    const panelId = `${select.id}SearchOptions`;
    input.setAttribute("aria-controls", panelId);
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "erp-select-search-toggle";
    toggle.setAttribute("aria-label", "Open searchable dropdown");
    toggle.innerHTML = "<span>⌄</span>";
    control.append(input, toggle);

    const panel = document.createElement("div");
    panel.className = "erp-select-panel";
    panel.id = panelId;
    panel.setAttribute("role", "listbox");
    wrapper.append(control, panel);

    const availableOptions = () => Array.from(select.options).filter(option => option.value && !option.disabled);
    const choose = option => {
      if (!option) return;
      select.value = option.value;
      input.value = option.textContent.trim();
      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
      wrapper.classList.remove("open");
      input.setAttribute("aria-expanded", "false");
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    };
    const render = (query = "") => {
      const needle = String(query || "").trim().toLowerCase();
      const matches = availableOptions().filter(option => !needle || `${option.value} ${option.textContent}`.toLowerCase().includes(needle));
      panel.replaceChildren();
      if (!matches.length) {
        const empty = document.createElement("div");
        empty.className = "erp-select-no-results";
        empty.textContent = availableOptions().length ? "No matching records" : (select.options[0]?.textContent.trim() || "No records available");
        panel.appendChild(empty);
        return;
      }
      matches.forEach(option => {
        const optionButton = document.createElement("button");
        optionButton.type = "button";
        optionButton.className = "erp-select-option" + (option.selected ? " selected" : "");
        optionButton.textContent = option.textContent;
        optionButton.dataset.value = option.value;
        optionButton.addEventListener("click", () => choose(option));
        panel.appendChild(optionButton);
      });
    };
    const sync = () => {
      const selected = select.options[select.selectedIndex];
      if (!wrapper.classList.contains("open") || document.activeElement !== input) input.value = select.value && selected ? selected.textContent.trim() : "";
      input.placeholder = select.options[0]?.textContent.trim() || "Type to search or open dropdown";
      input.disabled = select.disabled;
      toggle.disabled = select.disabled;
      input.setAttribute("aria-expanded", String(wrapper.classList.contains("open")));
      if (wrapper.classList.contains("open")) render(document.activeElement === input ? input.value : "");
    };
    const open = (showAll = false) => {
      if (select.disabled) return;
      closeAll(wrapper);
      wrapper.classList.add("open");
      input.setAttribute("aria-expanded", "true");
      render(showAll ? "" : input.value);
    };

    const state = { wrapper, searchable: true, sync };
    selectStates.set(select, state);
    wrapperStates.set(wrapper, state);
    input.addEventListener("focus", () => { open(true); if (input.value) input.select(); });
    input.addEventListener("input", () => {
      if (select.value) {
        select.value = "";
        select.dispatchEvent(new Event("input", { bubbles: true }));
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
      open(false);
      render(input.value);
    });
    input.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        const first = panel.querySelector(".erp-select-option");
        if (first) {
          event.preventDefault();
          const option = availableOptions().find(item => item.value === first.dataset.value);
          choose(option);
        }
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        open(false);
        panel.querySelector(".erp-select-option")?.focus();
      } else if (event.key === "Escape") {
        wrapper.classList.remove("open");
        sync();
      }
    });
    panel.addEventListener("keydown", event => {
      const buttons = Array.from(panel.querySelectorAll(".erp-select-option"));
      const index = buttons.indexOf(document.activeElement);
      if (event.key === "ArrowDown" && buttons.length) { event.preventDefault(); buttons[(index + 1) % buttons.length].focus(); }
      if (event.key === "ArrowUp" && buttons.length) { event.preventDefault(); buttons[(index - 1 + buttons.length) % buttons.length].focus(); }
      if (event.key === "Escape") { event.preventDefault(); input.focus(); wrapper.classList.remove("open"); sync(); }
    });
    toggle.addEventListener("click", () => {
      const opening = !wrapper.classList.contains("open");
      if (opening) { input.focus(); open(true); }
      else { wrapper.classList.remove("open"); sync(); }
    });
    select.addEventListener("change", sync);
    new MutationObserver(sync).observe(select, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["disabled", "selected"] });
    installValueSync(select, sync);
    sync();
  };

  const syncSelect = select => {
    const state = selectStates.get(select);
    if (!state) return;
    const selected = select.options[select.selectedIndex] || select.options[0];
    const text = selected ? selected.textContent.trim() : "-- Select --";
    state.value.textContent = text;
    state.value.classList.toggle("erp-select-placeholder", !select.value);
    state.button.disabled = select.disabled;
    state.button.setAttribute("aria-expanded", String(state.wrapper.classList.contains("open")));
    state.panel.replaceChildren();
    Array.from(select.options).forEach((option, index) => {
      const optionButton = document.createElement("button");
      optionButton.type = "button";
      optionButton.className = "erp-select-option" + (option.selected ? " selected" : "");
      optionButton.textContent = option.textContent;
      optionButton.disabled = option.disabled;
      optionButton.addEventListener("click", () => {
        if (option.disabled) return;
        select.value = option.value;
        select.dispatchEvent(new Event("input", { bubbles: true }));
        select.dispatchEvent(new Event("change", { bubbles: true }));
        syncSelect(select);
        state.wrapper.classList.remove("open");
        state.button.focus();
      });
      state.panel.appendChild(optionButton);
    });
  };

  const enhanceSelect = select => {
    if (!(select instanceof HTMLSelectElement) || select.multiple || select.size > 1 || select.dataset.erpSelectReady || select.dataset.erpSelectSkip) return;
    if (searchableSelectIds.has(select.id)) { enhanceSearchableSelect(select); return; }
    select.dataset.erpSelectReady = "true";
    const wrapper = document.createElement("div");
    wrapper.className = "erp-select";
    select.parentNode.insertBefore(wrapper, select);
    wrapper.appendChild(select);
    select.classList.add("erp-select-native");

    const button = document.createElement("button");
    button.type = "button";
    button.className = "erp-select-button";
    button.setAttribute("aria-haspopup", "listbox");
    button.setAttribute("aria-expanded", "false");
    const value = document.createElement("span");
    value.className = "erp-select-value";
    const arrow = document.createElement("span");
    arrow.className = "erp-select-arrow";
    arrow.textContent = "⌄";
    button.append(value, arrow);

    const panel = document.createElement("div");
    panel.className = "erp-select-panel";
    panel.setAttribute("role", "listbox");
    wrapper.append(button, panel);
    const state = { wrapper, button, value, panel };
    selectStates.set(select, state);
    wrapperStates.set(wrapper, state);

    button.addEventListener("click", () => {
      if (select.disabled) return;
      const isOpening = !wrapper.classList.contains("open");
      closeAll(wrapper);
      syncSelect(select);
      wrapper.classList.toggle("open", isOpening);
      button.setAttribute("aria-expanded", String(isOpening));
      if (isOpening) {
        setTimeout(() => panel.querySelector(".erp-select-option.selected")?.scrollIntoView({ block: "nearest" }), 0);
      }
    });
    select.addEventListener("change", () => syncSelect(select));
    const optionObserver = new MutationObserver(() => syncSelect(select));
    optionObserver.observe(select, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["disabled", "selected"] });

    installValueSync(select, () => syncSelect(select));
    syncSelect(select);
  };

  const enhanceWithin = root => {
    if (root instanceof HTMLSelectElement) enhanceSelect(root);
    if (root.querySelectorAll) root.querySelectorAll("select").forEach(enhanceSelect);
  };

  document.addEventListener("pointerdown", event => {
    if (!event.target.closest(".erp-select")) closeAll();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") closeAll();
  });
  enhanceWithin(document);
  new MutationObserver(mutations => {
    mutations.forEach(mutation => {
      if (mutation.type === "childList") mutation.addedNodes.forEach(node => {
        if (node.nodeType === Node.ELEMENT_NODE) enhanceWithin(node);
      });
    });
  }).observe(document.body, { childList: true, subtree: true });
})();

initDatabase();

