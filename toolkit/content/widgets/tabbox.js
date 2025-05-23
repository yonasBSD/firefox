/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

// This is loaded into chrome windows with the subscript loader. Wrap in
// a block to prevent accidentally leaking globals onto `window`.
{
  const { AppConstants } = ChromeUtils.importESModule(
    "resource://gre/modules/AppConstants.sys.mjs"
  );

  let imports = {};
  ChromeUtils.defineESModuleGetters(imports, {
    ShortcutUtils: "resource://gre/modules/ShortcutUtils.sys.mjs",
  });

  const DIRECTION_BACKWARD = -1;
  const DIRECTION_FORWARD = 1;

  class MozTabbox extends MozXULElement {
    constructor() {
      super();
      this._handleMetaAltArrows = AppConstants.platform == "macosx";
      this.disconnectedCallback = this.disconnectedCallback.bind(this);
    }

    connectedCallback() {
      document.addEventListener("keydown", this, { mozSystemGroup: true });
      window.addEventListener("unload", this.disconnectedCallback, {
        once: true,
      });
    }

    disconnectedCallback() {
      document.removeEventListener("keydown", this, { mozSystemGroup: true });
      window.removeEventListener("unload", this.disconnectedCallback);
    }

    set handleCtrlTab(val) {
      this.setAttribute("handleCtrlTab", val);
    }

    get handleCtrlTab() {
      return this.getAttribute("handleCtrlTab") != "false";
    }

    get tabs() {
      if (this.hasAttribute("tabcontainer")) {
        return document.getElementById(this.getAttribute("tabcontainer"));
      }
      return this.getElementsByTagNameNS(
        "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
        "tabs"
      ).item(0);
    }

    get tabpanels() {
      return this.getElementsByTagNameNS(
        "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
        "tabpanels"
      ).item(0);
    }

    set selectedIndex(val) {
      let tabs = this.tabs;
      if (tabs) {
        tabs.selectedIndex = val;
      }
      this.setAttribute("selectedIndex", val);
    }

    get selectedIndex() {
      let tabs = this.tabs;
      return tabs ? tabs.selectedIndex : -1;
    }

    set selectedTab(val) {
      if (val) {
        let tabs = this.tabs;
        if (tabs) {
          tabs.selectedItem = val;
        }
      }
    }

    get selectedTab() {
      let tabs = this.tabs;
      return tabs && tabs.selectedItem;
    }

    set selectedPanel(val) {
      if (val) {
        let tabpanels = this.tabpanels;
        if (tabpanels) {
          tabpanels.selectedPanel = val;
        }
      }
    }

    get selectedPanel() {
      let tabpanels = this.tabpanels;
      return tabpanels && tabpanels.selectedPanel;
    }

    handleEvent(event) {
      if (!event.isTrusted) {
        // Don't let untrusted events mess with tabs.
        return;
      }

      // Skip this only if something has explicitly cancelled it.
      if (event.defaultCancelled) {
        return;
      }

      // Skip if chrome code has cancelled this:
      if (event.defaultPreventedByChrome) {
        return;
      }

      // Don't check if the event was already consumed because tab
      // navigation should always work for better user experience.

      const { ShortcutUtils } = imports;

      switch (ShortcutUtils.getSystemActionForEvent(event)) {
        case ShortcutUtils.CYCLE_TABS:
          Glean.browserUiInteraction.keyboard["ctrl-tab"].add(1);
          Services.prefs.setBoolPref(
            "browser.engagement.ctrlTab.has-used",
            true
          );
          if (this.tabs && this.handleCtrlTab) {
            this.tabs.advanceSelectedTab(
              event.shiftKey ? DIRECTION_BACKWARD : DIRECTION_FORWARD,
              true
            );
            event.preventDefault();
          }
          break;
        case ShortcutUtils.PREVIOUS_TAB:
          if (this.tabs) {
            this.tabs.advanceSelectedTab(DIRECTION_BACKWARD, true);
            event.preventDefault();
          }
          break;
        case ShortcutUtils.NEXT_TAB:
          if (this.tabs) {
            this.tabs.advanceSelectedTab(DIRECTION_FORWARD, true);
            event.preventDefault();
          }
          break;
      }
    }
  }

  customElements.define("tabbox", MozTabbox);

  class MozDeck extends MozXULElement {
    get isAsync() {
      return this.getAttribute("async") == "true";
    }

    connectedCallback() {
      if (this.delayConnectedCallback()) {
        return;
      }
      this._selectedPanel = null;
      this._inAsyncOperation = false;

      let selectCurrentIndex = () => {
        // Try to select the new node if any.
        let index = this.selectedIndex;
        let oldPanel = this._selectedPanel;
        this._selectedPanel = this.children.item(index) || null;
        this.updateSelectedIndex(index, oldPanel);
      };

      this._mutationObserver = new MutationObserver(records => {
        let anyRemovals = records.some(record => !!record.removedNodes.length);
        if (anyRemovals) {
          // Try to keep the current selected panel in-place first.
          let index = Array.from(this.children).indexOf(this._selectedPanel);
          if (index != -1) {
            // Try to keep the same node selected.
            this.setAttribute("selectedIndex", index);
          }
        }
        // Select the current index if needed in case mutations have made that
        // available where it wasn't before.
        if (!this._inAsyncOperation) {
          selectCurrentIndex();
        }
      });

      this._mutationObserver.observe(this, {
        childList: true,
      });

      selectCurrentIndex();
    }

    disconnectedCallback() {
      this._mutationObserver?.disconnect();
      this._mutationObserver = null;
    }

    updateSelectedIndex(
      val,
      oldPanel = this.querySelector(":scope > .deck-selected")
    ) {
      this._inAsyncOperation = false;
      if (oldPanel != this._selectedPanel) {
        oldPanel?.classList.remove("deck-selected");
        this._selectedPanel?.classList.add("deck-selected");
      }
      this.setAttribute("selectedIndex", val);
    }

    set selectedIndex(val) {
      if (val < 0 || val >= this.children.length) {
        return;
      }

      let oldPanel = this._selectedPanel;
      this._selectedPanel = this.children[val];

      this._inAsyncOperation = this.isAsync;
      if (!this._inAsyncOperation) {
        this.updateSelectedIndex(val, oldPanel);
      }

      if (this._selectedPanel != oldPanel) {
        let event = document.createEvent("Events");
        event.initEvent("select", true, true);
        this.dispatchEvent(event);
      }
    }

    get selectedIndex() {
      let indexStr = this.getAttribute("selectedIndex");
      return indexStr ? parseInt(indexStr) : 0;
    }

    set selectedPanel(val) {
      this.selectedIndex = Array.from(this.children).indexOf(val);
    }

    get selectedPanel() {
      return this._selectedPanel;
    }
  }

  customElements.define("deck", MozDeck);

  class MozTabpanels extends MozDeck {
    constructor() {
      super();
      this._tabbox = null;
    }

    get tabbox() {
      // Memoize the result rather than replacing this getter, so that
      // it can be reset if the parent changes.
      if (this._tabbox) {
        return this._tabbox;
      }

      return (this._tabbox = this.closest("tabbox"));
    }

    /**
     * nsIDOMXULRelatedElement
     */
    getRelatedElement(aTabPanelElm) {
      if (!aTabPanelElm) {
        return null;
      }

      let tabboxElm = this.tabbox;
      if (!tabboxElm) {
        return null;
      }

      let tabsElm = tabboxElm.tabs;
      if (!tabsElm) {
        return null;
      }

      // Return tab element having 'linkedpanel' attribute equal to the id
      // of the tab panel or the same index as the tab panel element.
      let tabpanelIdx = Array.prototype.indexOf.call(
        this.children,
        aTabPanelElm
      );
      if (tabpanelIdx == -1) {
        return null;
      }

      let tabElms = tabsElm.allTabs;
      let tabElmFromIndex = tabElms[tabpanelIdx];

      let tabpanelId = aTabPanelElm.id;
      if (tabpanelId) {
        for (let idx = 0; idx < tabElms.length; idx++) {
          let tabElm = tabElms[idx];
          if (tabElm.linkedPanel == tabpanelId) {
            return tabElm;
          }
        }
      }

      return tabElmFromIndex;
    }
  }

  MozXULElement.implementCustomInterface(MozTabpanels, [
    Ci.nsIDOMXULRelatedElement,
  ]);
  customElements.define("tabpanels", MozTabpanels);

  MozElements.MozTab = class MozTab extends MozElements.BaseText {
    static get markup() {
      return `
        <hbox class="tab-middle box-inherit" flex="1">
          <image class="tab-icon" role="presentation"></image>
          <label class="tab-text" flex="1" role="presentation"></label>
        </hbox>
      `;
    }

    constructor() {
      super();

      this.addEventListener("mousedown", this);
      this.addEventListener("keydown", this);

      this.arrowKeysShouldWrap = AppConstants.platform == "macosx";
    }

    static get inheritedAttributes() {
      return {
        ".tab-middle": "align,dir,pack,orient,selected,visuallyselected",
        ".tab-icon": "validate,src=image",
        ".tab-text": "value=label,accesskey,crop,disabled",
      };
    }

    connectedCallback() {
      if (!this._initialized) {
        this.textContent = "";
        this.appendChild(this.constructor.fragment);
        this.initializeAttributeInheritance();
        this._initialized = true;
      }
    }

    on_mousedown(event) {
      if (event.button != 0 || this.disabled) {
        return;
      }

      this.container.ariaFocusedItem = null;

      if (this == this.container.selectedItem) {
        // This tab is already selected and we will fall
        // through to mousedown behavior which sets focus on the current tab,
        // Only a click on an already selected tab should focus the tab itself.
        return;
      }

      let stopwatchid = this.container.getAttribute("stopwatchid");
      let timerId;
      if (stopwatchid) {
        timerId = Glean.browserTimings[stopwatchid].start();
      }

      // Call this before setting the 'ignorefocus' attribute because this
      // will pass on focus if the formerly selected tab was focused as well.
      this.container._selectNewTab(this);

      var isTabFocused = false;
      try {
        isTabFocused = document.commandDispatcher.focusedElement == this;
      } catch (e) {}

      // Set '-moz-user-focus' to 'ignore' so that PostHandleEvent() can't
      // focus the tab; we only want tabs to be focusable by the mouse if
      // they are already focused. After a short timeout we'll reset
      // '-moz-user-focus' so that tabs can be focused by keyboard again.
      if (!isTabFocused) {
        this.setAttribute("ignorefocus", "true");
        setTimeout(tab => tab.removeAttribute("ignorefocus"), 0, this);
      }

      if (stopwatchid) {
        Glean.browserTimings[stopwatchid].stopAndAccumulate(timerId);
      }
    }

    /**
     * @returns {"ltr"|"rtl"}
     */
    #getDirection() {
      return window.getComputedStyle(this).direction;
    }

    /**
     * @param {KeyEvent} event
     */
    on_keydown(event) {
      if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) {
        return;
      }

      // Handles some keyboard interactions when the active tab is in focus.
      switch (event.keyCode) {
        case KeyEvent.DOM_VK_LEFT: {
          this.container.advanceSelectedItem(
            this.#getDirection() == "ltr"
              ? DIRECTION_BACKWARD
              : DIRECTION_FORWARD,
            this.arrowKeysShouldWrap
          );
          event.preventDefault();
          break;
        }

        case KeyEvent.DOM_VK_RIGHT: {
          this.container.advanceSelectedItem(
            this.#getDirection() == "ltr"
              ? DIRECTION_FORWARD
              : DIRECTION_BACKWARD,
            this.arrowKeysShouldWrap
          );
          event.preventDefault();
          break;
        }

        case KeyEvent.DOM_VK_UP:
          this.container.advanceSelectedItem(
            DIRECTION_BACKWARD,
            this.arrowKeysShouldWrap
          );
          event.preventDefault();
          break;

        case KeyEvent.DOM_VK_DOWN:
          this.container.advanceSelectedItem(
            DIRECTION_FORWARD,
            this.arrowKeysShouldWrap
          );
          event.preventDefault();
          break;

        case KeyEvent.DOM_VK_HOME:
          this.container._selectNewTab(this.allTabs.at(0), DIRECTION_FORWARD);
          event.preventDefault();
          break;

        case KeyEvent.DOM_VK_END: {
          this.container._selectNewTab(this.allTabs.at(-1), DIRECTION_BACKWARD);
          event.preventDefault();
          break;
        }
      }
    }

    set value(val) {
      this.setAttribute("value", val);
    }

    get value() {
      return this.getAttribute("value") || "";
    }

    get container() {
      return this.closest("tabs");
    }

    // nsIDOMXULSelectControlItemElement
    get control() {
      return this.container;
    }

    get selected() {
      return this.getAttribute("selected") == "true";
    }

    set _selected(val) {
      if (val) {
        this.setAttribute("selected", "true");
        this.setAttribute("visuallyselected", "true");
      } else {
        this.removeAttribute("selected");
        this.removeAttribute("visuallyselected");
      }
    }

    /** @returns {boolean} */
    get visible() {
      return !this.hidden;
    }

    set linkedPanel(val) {
      this.setAttribute("linkedpanel", val);
    }

    get linkedPanel() {
      return this.getAttribute("linkedpanel");
    }
  };

  MozXULElement.implementCustomInterface(MozElements.MozTab, [
    Ci.nsIDOMXULSelectControlItemElement,
  ]);
  customElements.define("tab", MozElements.MozTab);

  const ARIA_FOCUSED_CLASS_NAME = "tablist-keyboard-focus";

  class TabsBase extends MozElements.BaseControl {
    constructor() {
      super();

      this.addEventListener("DOMMouseScroll", event => {
        if (Services.prefs.getBoolPref("toolkit.tabbox.switchByScrolling")) {
          if (event.detail > 0) {
            this.advanceSelectedTab(DIRECTION_FORWARD, false);
          } else {
            this.advanceSelectedTab(DIRECTION_BACKWARD, false);
          }
          event.stopPropagation();
        }
      });
    }

    // to be called from derived class connectedCallback
    baseConnect() {
      this._tabbox = null;
      this.ACTIVE_DESCENDANT_ID = `${ARIA_FOCUSED_CLASS_NAME}-${Math.trunc(
        Math.random() * 1000000
      )}`;

      if (!this.hasAttribute("orient")) {
        this.setAttribute("orient", "horizontal");
      }

      if (this.tabbox && this.tabbox.hasAttribute("selectedIndex")) {
        let selectedIndex = parseInt(this.tabbox.getAttribute("selectedIndex"));
        this.selectedIndex = selectedIndex > 0 ? selectedIndex : 0;
        return;
      }

      let children = this.allTabs;
      let length = children.length;
      for (var i = 0; i < length; i++) {
        if (children[i].getAttribute("selected") == "true") {
          this.selectedIndex = i;
          return;
        }
      }

      var value = this.value;
      if (value) {
        this.value = value;
      } else {
        this.selectedIndex = 0;
      }
    }

    /**
     * nsIDOMXULSelectControlElement
     */
    get itemCount() {
      return this.allTabs.length;
    }

    set value(val) {
      this.setAttribute("value", val);
      var children = this.allTabs;
      for (var c = children.length - 1; c >= 0; c--) {
        if (children[c].value == val) {
          this.selectedIndex = c;
          break;
        }
      }
    }

    get value() {
      return this.getAttribute("value") || "";
    }

    get tabbox() {
      if (!this._tabbox) {
        // Memoize the result in a field rather than replacing this property,
        // so that it can be reset along with the binding.
        this._tabbox = this.closest("tabbox");
      }

      return this._tabbox;
    }

    /**
     * @param {number} val
     */
    set selectedIndex(val) {
      var tab = this.getItemAtIndex(val);
      if (!tab) {
        return;
      }
      for (let otherTab of this.allTabs) {
        if (otherTab != tab && otherTab.selected) {
          otherTab._selected = false;
        }
      }
      tab._selected = true;

      this.setAttribute("value", tab.value);

      let linkedPanel = this.getRelatedElement(tab);
      if (linkedPanel) {
        this.tabbox.setAttribute("selectedIndex", val);

        // This will cause an onselect event to fire for the tabpanel
        // element.
        this.tabbox.tabpanels.selectedPanel = linkedPanel;
      }
    }

    /**
     * @returns {number}
     */
    get selectedIndex() {
      const tabs = this.allTabs;
      for (var i = 0; i < tabs.length; i++) {
        if (tabs[i].selected) {
          return i;
        }
      }
      return -1;
    }

    /**
     * @param {MozTab|null} [val]
     */
    set selectedItem(val) {
      if (val && !val.selected) {
        // The selectedIndex setter ignores invalid values
        // such as -1 if |val| isn't one of our child nodes.
        this.selectedIndex = this.getIndexOfItem(val);
      }
    }

    /**
     * @returns {MozTab|null}
     */
    get selectedItem() {
      const tabs = this.allTabs;
      for (var i = 0; i < tabs.length; i++) {
        if (tabs[i].selected) {
          return tabs[i];
        }
      }
      return null;
    }

    /**
     * @returns {MozTab[]}
     */
    get ariaFocusableItems() {
      return this.allTabs;
    }

    /**
     * @returns {number}
     */
    get ariaFocusedIndex() {
      const items = this.ariaFocusableItems;
      for (var i = 0; i < items.length; i++) {
        if (items[i].id == this.ACTIVE_DESCENDANT_ID) {
          return i;
        }
      }
      return -1;
    }

    /**
     * @param {MozTab|null} [val]
     */
    set ariaFocusedItem(val) {
      let setNewItem = val && this.ariaFocusableItems.includes(val);
      let clearExistingItem = this.ariaFocusedItem && (!val || setNewItem);

      if (clearExistingItem) {
        let ariaFocusedItem = this.ariaFocusedItem;
        ariaFocusedItem.classList.remove(ARIA_FOCUSED_CLASS_NAME);
        ariaFocusedItem.id = "";
        this.selectedItem.removeAttribute("aria-activedescendant");
        let evt = new CustomEvent("AriaFocus");
        this.selectedItem.dispatchEvent(evt);
      }

      if (setNewItem) {
        val.id = this.ACTIVE_DESCENDANT_ID;
        val.classList.add(ARIA_FOCUSED_CLASS_NAME);
        this.selectedItem.setAttribute(
          "aria-activedescendant",
          this.ACTIVE_DESCENDANT_ID
        );
        let evt = new CustomEvent("AriaFocus");
        val.dispatchEvent(evt);
      }
    }

    /**
     * @returns {MozTab|null}
     */
    get ariaFocusedItem() {
      return document.getElementById(this.ACTIVE_DESCENDANT_ID);
    }

    /**
     * nsIDOMXULRelatedElement
     */
    getRelatedElement(aTabElm) {
      if (!aTabElm) {
        return null;
      }

      let tabboxElm = this.tabbox;
      if (!tabboxElm) {
        return null;
      }

      let tabpanelsElm = tabboxElm.tabpanels;
      if (!tabpanelsElm) {
        return null;
      }

      // Get linked tab panel by 'linkedpanel' attribute on the given tab
      // element.
      let linkedPanelId = aTabElm.linkedPanel;
      if (linkedPanelId) {
        return this.ownerDocument.getElementById(linkedPanelId);
      }

      // otherwise linked tabpanel element has the same index as the given
      // tab element.
      let tabElmIdx = this.getIndexOfItem(aTabElm);
      return tabpanelsElm.children[tabElmIdx];
    }

    /**
     * @param {MozTab} item
     * @returns {number}
     */
    getIndexOfItem(item) {
      return Array.prototype.indexOf.call(this.allTabs, item);
    }

    /**
     * @param {numb} index
     * @returns {MozTab|null}
     */
    getItemAtIndex(index) {
      return this.allTabs[index] || null;
    }

    /**
     * Find an adjacent tab.
     *
     * @param {MozTab} startTab
     *   A `<tab>` element to start searching from.
     * @param {object} opts
     * @param {Number} [opts.direction=1]
     *   1 to search forward, -1 to search backward.
     * @param {Boolean} [opts.wrap=false]
     *   If true, wrap around if the search reaches the end (or beginning)
     *   of the tab strip.
     * @param {Boolean} [opts.startWithAdjacent=true]
     *   If true (which is the default), start searching from the next tab
     *   after (or before) `startTab`. If false, `startTab` may be returned
     *   if it passes the filter.
     * @param {function(MozTab):boolean} [opts.filter]
     *   A function to select which tabs to return.
     * @return {MozTab|null}
     *   The next `<tab>` element or, if none exists, null.
     */
    findNextTab(startTab, opts = {}) {
      let {
        direction = 1,
        wrap = false,
        startWithAdjacent = true,
        filter = () => true,
      } = opts;

      let tab = startTab;
      if (!startWithAdjacent && filter(tab)) {
        return tab;
      }

      let children = this.allTabs;
      let i = children.indexOf(tab);
      if (i < 0) {
        return null;
      }

      while (true) {
        i += direction;
        if (wrap) {
          if (i < 0) {
            i = children.length - 1;
          } else if (i >= children.length) {
            i = 0;
          }
        } else if (i < 0 || i >= children.length) {
          return null;
        }

        tab = children[i];
        if (tab == startTab) {
          return null;
        }
        if (filter(tab)) {
          return tab;
        }
      }
    }

    /**
     * @param {MozTab} aNewTab
     * @param {-1|1} [aFallbackDir]
     * @param {boolean} [aWrap]
     * @returns
     */
    _selectNewTab(aNewTab, aFallbackDir, aWrap) {
      this.ariaFocusedItem = null;

      aNewTab = this.findNextTab(aNewTab, {
        direction: aFallbackDir,
        wrap: aWrap,
        startWithAdjacent: false,
        filter: tab =>
          !tab.hidden && !tab.disabled && this._canAdvanceToTab(tab),
      });

      var isTabFocused = false;
      try {
        isTabFocused =
          document.commandDispatcher.focusedElement == this.selectedItem;
      } catch (e) {}
      this.selectedItem = aNewTab;
      if (isTabFocused) {
        aNewTab.focus();
      } else if (this.getAttribute("setfocus") != "false") {
        let selectedPanel = this.tabbox.selectedPanel;
        document.commandDispatcher.advanceFocusIntoSubtree(selectedPanel);

        // Make sure that the focus doesn't move outside the tabbox
        if (this.tabbox) {
          try {
            let el = document.commandDispatcher.focusedElement;
            while (el && el != this.tabbox.tabpanels) {
              if (el == this.tabbox || el == selectedPanel) {
                return;
              }
              el = el.parentNode;
            }
            aNewTab.focus();
          } catch (e) {}
        }
      }
    }

    _canAdvanceToTab() {
      return true;
    }

    /**
     * Selects the next visible tab in this list of tabs.
     *
     * @param {-1|1} [aDir]
     * @param {boolean} [aWrap]
     */
    advanceSelectedTab(aDir, aWrap) {
      let { ariaFocusedItem } = this;
      let startTab = ariaFocusedItem;
      if (!ariaFocusedItem || !this.allTabs.includes(ariaFocusedItem)) {
        startTab = this.selectedItem;
      }
      let newTab = null;

      // Handle keyboard navigation for a hidden tab that can be selected, like the Firefox View tab,
      // which has a random placement in this.allTabs.
      if (startTab.hidden) {
        if (aDir == 1) {
          newTab = this.allTabs.find(tab => tab.visible);
        } else {
          newTab = this.allTabs.findLast(tab => tab.visible);
        }
      } else {
        newTab = this.findNextTab(startTab, {
          direction: aDir,
          wrap: aWrap,
          filter: tab => tab.visible,
        });
      }

      if (newTab && newTab != startTab) {
        this._selectNewTab(newTab, aDir, aWrap);
      }
    }

    /**
     * Selects the next visible item in this list of items.
     *
     * This provides an extension point for code to mix non-tab items inside
     * of this tab list and be able to appropriately and logically advance to
     * the next tab or non-tab.
     *
     * @param {-1|1} [aDir]
     * @param {boolean} [aWrap]
     */
    advanceSelectedItem(aDir, aWrap) {
      this.advanceSelectedTab(aDir, aWrap);
    }

    appendItem(label, value) {
      var tab = document.createXULElement("tab");
      tab.setAttribute("label", label);
      tab.setAttribute("value", value);
      this.appendChild(tab);
      return tab;
    }
  }

  MozXULElement.implementCustomInterface(TabsBase, [
    Ci.nsIDOMXULSelectControlElement,
    Ci.nsIDOMXULRelatedElement,
  ]);

  MozElements.TabsBase = TabsBase;

  class MozTabs extends TabsBase {
    connectedCallback() {
      if (this.delayConnectedCallback()) {
        return;
      }

      let start = MozXULElement.parseXULToFragment(
        `<spacer class="tabs-left"/>`
      );
      this.insertBefore(start, this.firstChild);

      let end = MozXULElement.parseXULToFragment(
        `<spacer class="tabs-right"/>`
      );
      this.insertBefore(end, null);

      this.baseConnect();
    }

    // Accessor for tabs.  This element has spacers as the first and
    // last elements and <tab>s are everything in between.
    get allTabs() {
      let children = Array.from(this.children);
      return children.splice(1, children.length - 2);
    }

    appendChild(tab) {
      // insert before the end spacer.
      this.insertBefore(tab, this.lastChild);
    }
  }

  customElements.define("tabs", MozTabs);
}
