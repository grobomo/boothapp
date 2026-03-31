/**
 * BoothApp i18n - lightweight translation module.
 *
 * Usage (browser):
 *   <script src="/infra/i18n/translations.js"></script>
 *   i18n.setLang('ja');
 *   i18n.t('card.activeSessions');          // "アクティブセッション"
 *   i18n.t('feed.refreshing', { n: 5 });    // "5秒後に更新"
 *
 * Auto-applies translations to any element with data-i18n="key".
 * Persists chosen language in localStorage.
 */
(function (root) {
    'use strict';

    var STORAGE_KEY = 'boothapp_lang';
    var DEFAULT_LANG = 'en';
    var catalogs = {};
    var currentLang = DEFAULT_LANG;

    // -- catalog management --------------------------------------------------

    function register(lang, entries) {
        catalogs[lang] = entries;
    }

    function getLang() {
        return currentLang;
    }

    function setLang(lang) {
        if (!catalogs[lang]) {
            console.warn('[i18n] Unknown language: ' + lang + ', falling back to ' + DEFAULT_LANG);
            lang = DEFAULT_LANG;
        }
        currentLang = lang;
        try { localStorage.setItem(STORAGE_KEY, lang); } catch (e) { /* private mode */ }
        applyAll();
    }

    // -- translation lookup --------------------------------------------------

    function t(key, params) {
        var catalog = catalogs[currentLang] || catalogs[DEFAULT_LANG] || {};
        var str = catalog[key];
        if (str === undefined) {
            // Fallback to English, then return the key itself
            str = (catalogs[DEFAULT_LANG] || {})[key];
            if (str === undefined) return key;
        }
        if (params) {
            Object.keys(params).forEach(function (k) {
                str = str.replace(new RegExp('\\{' + k + '\\}', 'g'), params[k]);
            });
        }
        return str;
    }

    // -- DOM auto-translation ------------------------------------------------

    function applyAll() {
        var els = document.querySelectorAll('[data-i18n]');
        for (var i = 0; i < els.length; i++) {
            var key = els[i].getAttribute('data-i18n');
            els[i].textContent = t(key);
        }
        // Update <html lang="...">
        document.documentElement.lang = currentLang;
    }

    // -- language switcher widget --------------------------------------------

    function createSwitcher(containerId) {
        var container = document.getElementById(containerId);
        if (!container) return;

        var langs = [
            { code: 'en', flag: 'EN', label: 'English' },
            { code: 'ja', flag: 'JA', label: '日本語' }
        ];

        // Build dropdown
        var wrapper = document.createElement('div');
        wrapper.className = 'i18n-switcher';
        wrapper.style.cssText = 'position:relative;display:inline-block;';

        var btn = document.createElement('button');
        btn.className = 'i18n-btn';
        btn.type = 'button';
        updateBtnLabel(btn);

        var menu = document.createElement('div');
        menu.className = 'i18n-menu';
        menu.style.display = 'none';

        langs.forEach(function (l) {
            var item = document.createElement('div');
            item.className = 'i18n-menu-item';
            item.setAttribute('data-lang', l.code);
            item.innerHTML = '<span class="i18n-flag">' + l.flag + '</span> ' + l.label;
            item.addEventListener('click', function () {
                setLang(l.code);
                updateBtnLabel(btn);
                menu.style.display = 'none';
            });
            menu.appendChild(item);
        });

        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
        });
        document.addEventListener('click', function () { menu.style.display = 'none'; });

        wrapper.appendChild(btn);
        wrapper.appendChild(menu);
        container.appendChild(wrapper);

        function updateBtnLabel(b) {
            var cur = langs.filter(function (l) { return l.code === currentLang; })[0] || langs[0];
            b.innerHTML = '<span class="i18n-flag">' + cur.flag + '</span> &#9662;';
        }
    }

    // -- init: restore saved language ----------------------------------------

    function init() {
        try {
            var saved = localStorage.getItem(STORAGE_KEY);
            if (saved && catalogs[saved]) currentLang = saved;
        } catch (e) { /* private mode */ }
    }

    // -- public API ----------------------------------------------------------

    root.i18n = {
        register: register,
        setLang: setLang,
        getLang: getLang,
        t: t,
        applyAll: applyAll,
        createSwitcher: createSwitcher,
        init: init
    };

})(typeof window !== 'undefined' ? window : this);
