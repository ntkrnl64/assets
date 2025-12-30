(function (global) {
  const DEFAULT_SESSION_HOURS = 6;
  const configPromise = fetch("/config/app-config.json", { cache: "no-store" })
    .then((res) => res.json())
    .catch(() => ({}));
  const controllers = new Set();

  class AuthorizationController {
    constructor(options) {
      this._explicitSessionHours = Boolean(options && Object.prototype.hasOwnProperty.call(options, "sessionHours"));
      this.options = Object.assign(
        {
          testType: null,
          apiBase: window.location.origin,
          sessionHours: DEFAULT_SESSION_HOURS,
          autoConsume: true,
          onAuthorized: null,
          redirect: null,
          startButtons: [],
          autoRun: false,
          useServerValidation: true,
        },
        options || {}
      );
      if (!this.options.testType) {
        throw new Error("AuthorizationSDK: testType is required");
      }
      this.state = {
        config: null,
        modal: null,
        serverEndpoint: this.options.apiBase.replace(/\/$/, "") + "/api",
        sessionKey: `auth:${this.options.testType}:session`,
      };
    }

    async bootstrap() {
      await this.loadRemoteConfig();
      if (this.options.startButtons.length) {
        this.attachStartButtons();
      }
      if (this.options.autoRun) {
        this.ensureAuthorized();
      }
      return this;
    }

    async loadRemoteConfig() {
      try {
        const resp = await fetch(`${this.state.serverEndpoint}/public/test-configs`, {
          headers: { Accept: "application/json" },
        });
        const data = await resp.json();
        if (data && data.items) {
          this.state.config = data.items.find((item) => item.test_type === this.options.testType) || null;
        }
        if (!this._explicitSessionHours && this.state.config && this.state.config.session_hours) {
          const hours = Number(this.state.config.session_hours);
          if (Number.isFinite(hours) && hours > 0) {
            this.options.sessionHours = hours;
          }
        }
      } catch (error) {
        console.warn("[AuthorizationSDK] failed to load remote config", error);
        this.state.config = null;
      }
    }

    attachStartButtons() {
      this.options.startButtons.forEach((selector) => {
        const el = document.querySelector(selector.trim());
        if (!el) {
          console.warn(`[AuthorizationSDK] start button not found: ${selector}`);
          return;
        }
        el.addEventListener("click", (evt) => {
          evt.preventDefault();
          this.ensureAuthorized();
        });
      });
    }

    isSessionActive() {
      try {
        const raw = sessionStorage.getItem(this.state.sessionKey);
        if (!raw) return false;
        const data = JSON.parse(raw);
        return data.expiresAt > Date.now();
      } catch (_) {
        return false;
      }
    }

    grantSession() {
      const expiresAt = Date.now() + this.options.sessionHours * 3600 * 1000;
      sessionStorage.setItem(this.state.sessionKey, JSON.stringify({ expiresAt }));
    }

    async ensureAuthorized(callback) {
      const authDisabled = this.state.config && this.state.config.auth_required === 0;
      if (authDisabled) {
        this.grantSession();
        this.handleAuthorized(callback);
        return true;
      }
      if (this.isSessionActive()) {
        this.handleAuthorized(callback);
        return true;
      }
      this.openModal(callback);
      return false;
    }

    handleAuthorized(callback) {
      if (typeof callback === "function") {
        callback();
      } else if (typeof this.options.onAuthorized === "function") {
        this.options.onAuthorized();
      } else if (typeof this.options.onAuthorized === "string" && typeof global[this.options.onAuthorized] === "function") {
        global[this.options.onAuthorized]();
      }
      if (this.options.redirect) {
        window.location.href = this.options.redirect;
      }
    }

    openModal(callback) {
      if (this.state.modal) {
        this.state.modal.remove();
      }
      const modal = buildModal(this.state.config, {
        onSubmit: async (codeInput, errorEl) => {
          errorEl.textContent = "";
          errorEl.style.display = "none";
          const code = codeInput.value.trim();
          if (!code) {
            errorEl.textContent = "请输入授权码";
            errorEl.style.display = "block";
            return;
          }
          const passed = await this.validateCode(code);
          if (passed) {
            this.grantSession();
            this.handleAuthorized(callback);
            modal.remove();
          } else {
            errorEl.textContent = "授权码无效或已失效";
            errorEl.style.display = "block";
          }
        },
        onClose: () => {
          modal.remove();
        },
      });
      this.state.modal = modal;
      document.body.appendChild(modal);
      setTimeout(() => modal.classList.add("visible"), 10);
    }

    async validateCode(code) {
      return true;
    }
  }

  function buildModal(testConfig, hooks) {
    const overlay = document.createElement("div");
    overlay.className = "auth-modal-overlay";
    const card = document.createElement("div");
    card.className = "auth-modal-card";

    const close = document.createElement("button");
    close.type = "button";
    close.className = "auth-close-btn";
    close.setAttribute("aria-label", "关闭");
    close.innerHTML = "&times;";
    close.addEventListener("click", () => {
      overlay.classList.remove("visible");
      setTimeout(() => hooks.onClose(), 200);
    });
    card.appendChild(close);

    const title = document.createElement("h2");
    title.textContent = "授权验证";
    card.appendChild(title);

    const desc = document.createElement("p");
    desc.className = "auth-modal-text";
    desc.textContent = "请输入授权码完成验证。";
    card.appendChild(desc);

    const buttonRow = document.createElement("div");
    buttonRow.className = "auth-link-row";
    const links = buildLinks(testConfig);
    links.forEach((link) => buttonRow.appendChild(link));
    if (links.length) {
      card.appendChild(buttonRow);
    }

    const inputRow = document.createElement("div");
    inputRow.className = "auth-input-row";
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "输入授权码";
    const submit = document.createElement("button");
    submit.type = "button";
    submit.textContent = "验证";
    submit.className = "auth-btn";
    inputRow.appendChild(input);
    inputRow.appendChild(submit);
    card.appendChild(inputRow);

    const error = document.createElement("div");
    error.className = "auth-error";
    error.style.display = "none";
    card.appendChild(error);

    submit.addEventListener("click", () => hooks.onSubmit(input, error));
    input.addEventListener("keyup", (evt) => {
      if (evt.key === "Enter") {
        hooks.onSubmit(input, error);
      }
    });

    overlay.appendChild(card);
    overlay.addEventListener("click", (evt) => {
      if (evt.target === overlay) {
        overlay.classList.remove("visible");
        setTimeout(() => hooks.onClose(), 200);
      }
    });
    return overlay;
  }

  function normalizeUrl(url) {
    if (!url) return "";
    let value = String(url).trim();
    if (!value) return "";
    if (/^[a-zA-Z][a-zA-Z0-9+\-.]*:/.test(value)) {
      return value;
    }
    if (value.startsWith("//")) {
      return window.location.protocol + value;
    }
    if (value.startsWith("/")) {
      return value;
    }
    if (/^www\./i.test(value) || /^[\w.-]+\.(com|cn|net|org|io|app)(\/|$)/i.test(value)) {
      return "https://" + value;
    }
    return value;
  }

  function buildLinks(testConfig) {
    const links = [];
    if (!testConfig) return links;
    const buttons = Array.isArray(testConfig.buttons) && testConfig.buttons.length
      ? testConfig.buttons
      : Array.isArray(testConfig.purchase_links)
      ? testConfig.purchase_links
      : [];
    buttons.forEach((button, index) => {
      if (button && button.url && button.label && button.show !== false && button.show !== 0) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "auth-link-btn";
        btn.textContent = button.label || `入口${index + 1}`;
        btn.addEventListener("click", () => {
          const targetUrl = normalizeUrl(button.url);
          if (targetUrl) {
            window.open(targetUrl, "_blank", "noopener");
          }
        });
        links.push(btn);
      }
    });
    return links;
  }

  function normalizeOptions(dataset) {
    const opts = Object.assign({}, dataset);
    if (typeof opts.autoRun !== "undefined") {
      opts.autoRun = ["true", "1", "yes", "on"].includes(String(opts.autoRun).toLowerCase());
    }
    if (typeof opts.startButton === "string") {
      opts.startButtons = opts.startButton.split(",").map((s) => s.trim()).filter(Boolean);
    }
    if (typeof opts.sessionHours !== "undefined") {
      opts.sessionHours = Number(opts.sessionHours) || DEFAULT_SESSION_HOURS;
    }
    return opts;
  }

  const AuthorizationSDK = {
    async init(options) {
      const controller = new AuthorizationController(options);
      const instance = await controller.bootstrap();
      controllers.add(instance);
      return instance;
    },
    async autoInit(scriptEl) {
      const dataset = normalizeOptions(scriptEl.dataset);
      if (!dataset.testType) return;
      const buttons = dataset.startButtons || [];
      let apiBase = dataset.apiBase;
      if (!apiBase) {
        const cfg = await configPromise;
        if (cfg && cfg.apiBase) {
          apiBase = cfg.apiBase;
        }
      }
      if (!apiBase) {
        apiBase = window.location.origin;
      }
      if (dataset.serverEndpoint) {
        apiBase = dataset.serverEndpoint.replace(/\/api\/?$/, "");
      }
      const opts = {
        testType: dataset.testType,
        apiBase: apiBase,
        startButtons: buttons,
        autoRun: dataset.autoRun || false,
        redirect: dataset.redirect || null,
        onAuthorized: dataset.onAuthorized || null,
      };
      if (typeof dataset.sessionHours !== "undefined") {
        opts.sessionHours = dataset.sessionHours || DEFAULT_SESSION_HOURS;
      }
      const controller = await AuthorizationSDK.init(opts);
      return controller;
    },
    attachStartButtons() {
      controllers.forEach((controller) => {
        if (controller && typeof controller.attachStartButtons === "function") {
          controller.attachStartButtons();
        }
      });
    },
    getControllers() {
      return Array.from(controllers);
    },
  };

  global.AuthorizationSDK = AuthorizationSDK;

  const current = document.currentScript;
  if (current && current.dataset && current.dataset.testType) {
    AuthorizationSDK.autoInit(current);
  }
})(window);
