(function () {
    "use strict";

    // ============================================================
    //  UA Online Parser — Lampa плагін для українських сайтів
    //  Сайти: ashdi.vip, eneyida.tv, uakino.com.ua, uaserials.my,
    //         kinotron.tv, kinokrad.co
    //  Функції: пошук, вибір озвучки, вибір якості відео
    // ============================================================

    var PLUGIN_ID   = "ua_online_parser";
    var PLUGIN_NAME = "UA Online";
    var VERSION     = "1.0.0";

    // ---- налаштування сайтів ----
    var SITES = {
        ashdi: {
            name:    "Ashdi",
            host:    "https://ashdi.vip",
            search:  "/api/search?q={query}&page={page}",
            movie:   "/video/{id}",
            serial:  "/serial/{id}",
            embed:   "/embed/{id}",
            enabled: true,
        },
        eneyida: {
            name:    "Eneyida",
            host:    "https://eneyida.tv",
            search:  "/api/search?q={query}",
            movie:   "/film/{id}",
            serial:  "/serial/{id}",
            embed:   "/embed/{id}",
            enabled: true,
        },
        uakino: {
            name:    "UAKino",
            host:    "https://uakino.com.ua",
            search:  "/search?q={query}",
            embed:   "/embed/{id}",
            enabled: true,
        },
        uaserials: {
            name:    "UASerials",
            host:    "https://uaserials.my",
            search:  "/index.php?do=search&q={query}",
            embed:   "/embed/{id}",
            enabled: true,
        },
        kinotron: {
            name:    "Kinotron",
            host:    "https://kinotron.tv",
            search:  "/search?q={query}",
            embed:   "/embed/{id}",
            enabled: true,
        },
        kinokrad: {
            name:    "KinoKrad",
            host:    "https://kinokrad.co",
            search:  "/index.php?do=search&subaction=search&story={query}",
            embed:   "/embed/{id}",
            enabled: true,
        },
    };

    // ---- переклади ----
    Lampa.Lang.add({
        ua_online_title:        { ru: "UA Online", uk: "UA Online", en: "UA Online" },
        ua_online_loading:      { ru: "Загрузка...", uk: "Завантаження...", en: "Loading..." },
        ua_online_no_results:   { ru: "Ничего не найдено", uk: "Нічого не знайдено", en: "Nothing found" },
        ua_online_voice:        { ru: "Озвучка", uk: "Озвучка", en: "Voice" },
        ua_online_quality:      { ru: "Качество", uk: "Якість", en: "Quality" },
        ua_online_season:       { ru: "Сезон", uk: "Сезон", en: "Season" },
        ua_online_episode:      { ru: "Серия", uk: "Серія", en: "Episode" },
        ua_online_source:       { ru: "Источник", uk: "Джерело", en: "Source" },
        ua_online_select_voice: { ru: "Выберите озвучку", uk: "Оберіть озвучку", en: "Select voice" },
        ua_online_select_qual:  { ru: "Выберите качество", uk: "Оберіть якість", en: "Select quality" },
        ua_online_err_load:     { ru: "Ошибка загрузки", uk: "Помилка завантаження", en: "Load error" },
        ua_online_err_parse:    { ru: "Ошибка парсинга", uk: "Помилка парсингу", en: "Parse error" },
        ua_online_settings:     { ru: "Настройки UA Online", uk: "Налаштування UA Online", en: "UA Online Settings" },
        ua_online_sites:        { ru: "Активные сайты", uk: "Активні сайти", en: "Active sites" },
    });

    // ============================================================
    //  Допоміжні функції
    // ============================================================

    function translate(obj) {
        if (!obj) return "";
        if (typeof obj === "string") return obj;
        var lang = Lampa.Storage.get("language", "uk");
        return obj[lang] || obj.uk || obj.ru || obj.en || "";
    }

    function enabledSites() {
        var list = [];
        Object.keys(SITES).forEach(function (key) {
            var saved = Lampa.Storage.get(PLUGIN_ID + "_site_" + key, true);
            if (saved && SITES[key].enabled) list.push(key);
        });
        return list;
    }

    // Замінює {key} у рядку
    function tpl(str, data) {
        return str.replace(/\{(\w+)\}/g, function (_, k) {
            return data[k] !== undefined ? encodeURIComponent(data[k]) : "";
        });
    }

    // Простий GET з cors-проксі або напряму
    function fetchUrl(url, callback, errorCallback) {
        $.ajax({
            url:     url,
            method:  "GET",
            timeout: 10000,
            success: callback,
            error:   function (xhr) {
                if (errorCallback) errorCallback(xhr.status);
            },
        });
    }

    // Витягти iframe src з HTML
    function extractIframeSrc(html) {
        var m = html.match(/iframe[^>]+src=["']([^"']+)["']/i);
        return m ? m[1] : null;
    }

    // Парсити m3u8/mp4 посилання з тексту
    function extractVideoLinks(text) {
        var links = [];
        // пряме m3u8
        var m3u = text.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/g) || [];
        m3u.forEach(function (u) { links.push({ quality: "auto", url: u, type: "hls" }); });
        // mp4
        var mp4 = text.match(/https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*/g) || [];
        mp4.forEach(function (u) { links.push({ quality: "mp4", url: u, type: "mp4" }); });
        return links;
    }

    // Парсити JSON-плейлист формату Ashdi/Eneyida
    // [{"id":1,"name":"Дубляж","files":[{"quality":"1080","url":"..."}]}]
    function parsePlaylistJson(json) {
        var voices = [];
        try {
            var data = typeof json === "string" ? JSON.parse(json) : json;
            if (!Array.isArray(data)) data = [data];
            data.forEach(function (voice) {
                var files = voice.files || voice.tracks || [];
                var qualities = [];
                files.forEach(function (f) {
                    qualities.push({
                        quality: f.quality || f.label || "auto",
                        url:     f.url || f.src || f.file || "",
                        type:    (f.url || "").indexOf(".m3u8") >= 0 ? "hls" : "mp4",
                    });
                });
                if (qualities.length) {
                    voices.push({
                        name:      voice.name || voice.title || voice.lang || "Озвучка",
                        id:        voice.id || 0,
                        qualities: qualities,
                    });
                }
            });
        } catch (e) {}
        return voices;
    }

    // Парсити JSON серіалів типу
    // {"seasons":[{"number":1,"episodes":[{"number":1,"voices":[...]}]}]}
    function parseSerialJson(json) {
        try {
            return typeof json === "string" ? JSON.parse(json) : json;
        } catch (e) { return null; }
    }

    // ============================================================
    //  Парсери для кожного сайту
    // ============================================================

    // ---------- ASHDI ----------
    var Ashdi = {
        name: "Ashdi",

        // Пошук через API
        search: function (params, callback, error) {
            var url = SITES.ashdi.host + tpl(SITES.ashdi.search, {
                query: params.query,
                page:  params.page || 1,
            });
            fetchUrl(url, function (data) {
                var results = [];
                try {
                    var list = data.results || data.movies || data || [];
                    list.forEach(function (item) {
                        results.push({
                            source: "ashdi",
                            id:     item.id || item.kp_id || "",
                            title:  item.title || item.name || "",
                            year:   item.year || "",
                            poster: item.poster || item.poster_url || "",
                            type:   item.type || "movie",
                        });
                    });
                } catch (e) {}
                callback(results);
            }, error);
        },

        // Отримати плейлист для фільму/серіалу
        getPlaylist: function (id, type, callback, error) {
            var path = type === "serial" ? SITES.ashdi.serial : SITES.ashdi.movie;
            var url = SITES.ashdi.host + tpl(path, { id: id });
            fetchUrl(url, function (html) {
                // шукаємо плейлист у скрипті
                var m = html.match(/translations\s*[:=]\s*(\[[\s\S]*?\])/);
                if (!m) m = html.match(/playlist\s*[:=]\s*(\[[\s\S]*?\])/);
                if (m) {
                    var voices = parsePlaylistJson(m[1]);
                    if (voices.length) return callback(voices);
                }
                // fallback — embed
                var embedSrc = extractIframeSrc(html);
                if (embedSrc) {
                    Ashdi.getEmbedPlaylist(embedSrc, callback, error);
                } else {
                    error && error("no_playlist");
                }
            }, error);
        },

        getEmbedPlaylist: function (embedUrl, callback, error) {
            fetchUrl(embedUrl, function (html) {
                var m = html.match(/translations\s*[:=]\s*(\[[\s\S]*?\])/);
                if (!m) m = html.match(/playlist\s*=\s*(\[[\s\S]*?\])/);
                if (m) {
                    callback(parsePlaylistJson(m[1]));
                } else {
                    var links = extractVideoLinks(html);
                    if (links.length) {
                        callback([{ name: "Основна", qualities: links }]);
                    } else {
                        error && error("parse_failed");
                    }
                }
            }, error);
        },
    };

    // ---------- ENEYIDA ----------
    var Eneyida = {
        name: "Eneyida",

        search: function (params, callback, error) {
            var url = SITES.eneyida.host + tpl(SITES.eneyida.search, { query: params.query });
            fetchUrl(url, function (data) {
                var results = [];
                try {
                    var list = Array.isArray(data) ? data : (data.results || data.movies || []);
                    list.forEach(function (item) {
                        results.push({
                            source: "eneyida",
                            id:     item.id || "",
                            title:  item.title || item.name || "",
                            year:   item.year || "",
                            poster: item.poster || "",
                            type:   item.type || "movie",
                        });
                    });
                } catch (e) {}
                callback(results);
            }, error);
        },

        getPlaylist: function (id, type, callback, error) {
            var path = type === "serial" ? SITES.eneyida.serial : SITES.eneyida.movie;
            var url  = SITES.eneyida.host + tpl(path, { id: id });
            fetchUrl(url, function (html) {
                var m = html.match(/translations\s*[:=]\s*(\[[\s\S]*?\])/);
                if (!m) m = html.match(/playlist\s*[:=]\s*(\[[\s\S]*?\])/);
                if (m) {
                    var voices = parsePlaylistJson(m[1]);
                    if (voices.length) return callback(voices);
                }
                var embedSrc = extractIframeSrc(html);
                if (embedSrc) {
                    var embedUrl = embedSrc.startsWith("http") ? embedSrc : (SITES.eneyida.host + embedSrc);
                    fetchUrl(embedUrl, function (ehtml) {
                        var em = ehtml.match(/translations\s*[:=]\s*(\[[\s\S]*?\])/);
                        if (em) {
                            callback(parsePlaylistJson(em[1]));
                        } else {
                            var links = extractVideoLinks(ehtml);
                            callback(links.length ? [{ name: "Основна", qualities: links }] : []);
                        }
                    }, error);
                } else {
                    callback([]);
                }
            }, error);
        },
    };

    // ---------- UAKINO ----------
    var UAKino = {
        name: "UAKino",

        search: function (params, callback, error) {
            var url = SITES.uakino.host + tpl(SITES.uakino.search, { query: params.query });
            fetchUrl(url, function (html) {
                var results = [];
                // парсимо HTML-результати
                var re = /<article[^>]*>([\s\S]*?)<\/article>/gi;
                var art;
                while ((art = re.exec(html)) !== null) {
                    var block = art[1];
                    var titleM = block.match(/class="[^"]*title[^"]*"[^>]*>([^<]+)</i);
                    var hrefM  = block.match(/href="([^"]+)"/);
                    var yearM  = block.match(/\b(20\d{2}|19\d{2})\b/);
                    var imgM   = block.match(/data-src="([^"]+)"|src="([^"]+\.(?:jpg|png|webp))"/i);
                    if (titleM && hrefM) {
                        var href = hrefM[1];
                        var idM  = href.match(/(\d+)\/?$/);
                        results.push({
                            source: "uakino",
                            id:     idM ? idM[1] : href,
                            title:  titleM[1].trim(),
                            year:   yearM ? yearM[1] : "",
                            poster: imgM ? (imgM[1] || imgM[2]) : "",
                            type:   href.indexOf("serial") >= 0 ? "serial" : "movie",
                            href:   href,
                        });
                    }
                }
                callback(results);
            }, error);
        },

        getPlaylist: function (id, type, callback, error) {
            // UAKino зазвичай вбудовує iframe з ashdi або власним плеєром
            var url = SITES.uakino.host + tpl(SITES.uakino.embed, { id: id });
            fetchUrl(url, function (html) {
                var m = html.match(/playlist\s*[:=]\s*(\[[\s\S]*?\])/);
                if (m) {
                    callback(parsePlaylistJson(m[1]));
                } else {
                    var links = extractVideoLinks(html);
                    callback(links.length ? [{ name: "Основна", qualities: links }] : []);
                }
            }, error);
        },
    };

    // ---------- UASERIALS ----------
    var UASerials = {
        name: "UASerials",

        search: function (params, callback, error) {
            var url = SITES.uaserials.host + tpl(SITES.uaserials.search, { query: params.query });
            fetchUrl(url, function (html) {
                var results = [];
                var re = /<a\s[^>]*href="([^"]+)"[^>]*class="[^"]*poster[^"]*"[\s\S]*?<\/a>/gi;
                var m;
                while ((m = re.exec(html)) !== null) {
                    var href   = m[1];
                    var block  = m[0];
                    var titleM = block.match(/title="([^"]+)"/i) || block.match(/alt="([^"]+)"/i);
                    var idM    = href.match(/(\d+)\/?$/);
                    var yearM  = block.match(/\b(20\d{2}|19\d{2})\b/);
                    var imgM   = block.match(/src="([^"]+\.(?:jpg|png|webp))"/i);
                    if (titleM) {
                        results.push({
                            source: "uaserials",
                            id:     idM ? idM[1] : href,
                            title:  titleM[1].trim(),
                            year:   yearM ? yearM[1] : "",
                            poster: imgM ? imgM[1] : "",
                            type:   "serial",
                            href:   href,
                        });
                    }
                }
                callback(results);
            }, error);
        },

        getPlaylist: function (id, type, callback, error) {
            var url = SITES.uaserials.host + tpl(SITES.uaserials.embed, { id: id });
            fetchUrl(url, function (html) {
                var m = html.match(/translations\s*[:=]\s*(\[[\s\S]*?\])/);
                if (!m) m = html.match(/playlist\s*[:=]\s*(\[[\s\S]*?\])/);
                if (m) {
                    callback(parsePlaylistJson(m[1]));
                } else {
                    var links = extractVideoLinks(html);
                    callback(links.length ? [{ name: "Основна", qualities: links }] : []);
                }
            }, error);
        },
    };

    // ---------- KINOTRON ----------
    var Kinotron = {
        name: "Kinotron",

        search: function (params, callback, error) {
            var url = SITES.kinotron.host + tpl(SITES.kinotron.search, { query: params.query });
            fetchUrl(url, function (html) {
                var results = [];
                var re = /<div[^>]*class="[^"]*movie[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
                var art;
                while ((art = re.exec(html)) !== null) {
                    var block = art[1];
                    var hrefM  = block.match(/href="([^"]+)"/);
                    var titleM = block.match(/<h\d[^>]*>([^<]+)<\/h\d>/i)
                                 || block.match(/title="([^"]+)"/i);
                    var idM    = hrefM && hrefM[1].match(/(\d+)\/?$/);
                    var yearM  = block.match(/\b(20\d{2}|19\d{2})\b/);
                    var imgM   = block.match(/data-src="([^"]+)"|src="([^"]+\.(?:jpg|png|webp))"/i);
                    if (titleM && hrefM) {
                        results.push({
                            source: "kinotron",
                            id:     idM ? idM[1] : hrefM[1],
                            title:  (titleM[1] || titleM[2] || "").trim(),
                            year:   yearM ? yearM[1] : "",
                            poster: imgM ? (imgM[1] || imgM[2]) : "",
                            type:   "movie",
                            href:   hrefM[1],
                        });
                    }
                }
                callback(results);
            }, error);
        },

        getPlaylist: function (id, type, callback, error) {
            var url = SITES.kinotron.host + tpl(SITES.kinotron.embed, { id: id });
            fetchUrl(url, function (html) {
                var m = html.match(/playlist\s*[:=]\s*(\[[\s\S]*?\])/);
                if (!m) m = html.match(/sources\s*:\s*(\[[\s\S]*?\])/);
                if (m) {
                    callback(parsePlaylistJson(m[1]));
                } else {
                    var links = extractVideoLinks(html);
                    callback(links.length ? [{ name: "Основна", qualities: links }] : []);
                }
            }, error);
        },
    };

    // ---------- KINOKRAD ----------
    var KinoKrad = {
        name: "KinoKrad",

        search: function (params, callback, error) {
            var url = SITES.kinokrad.host + tpl(SITES.kinokrad.search, { query: params.query });
            fetchUrl(url, function (html) {
                var results = [];
                var re = /<a[^>]+href="([^"]+)"[^>]*>\s*<img[^>]+(?:data-src|src)="([^"]+)"[^>]*alt="([^"]+)"/gi;
                var m;
                while ((m = re.exec(html)) !== null) {
                    var href   = m[1];
                    var poster = m[2];
                    var title  = m[3];
                    var idM    = href.match(/(\d+)\/?$/);
                    var yearM  = title.match(/\b(20\d{2}|19\d{2})\b/);
                    results.push({
                        source: "kinokrad",
                        id:     idM ? idM[1] : href,
                        title:  title.replace(/\s*\(.*?\)/, "").trim(),
                        year:   yearM ? yearM[1] : "",
                        poster: poster,
                        type:   href.indexOf("serial") >= 0 ? "serial" : "movie",
                        href:   href,
                    });
                }
                callback(results);
            }, error);
        },

        getPlaylist: function (id, type, callback, error) {
            var url = SITES.kinokrad.host + tpl(SITES.kinokrad.embed, { id: id });
            fetchUrl(url, function (html) {
                var m = html.match(/translations\s*[:=]\s*(\[[\s\S]*?\])/);
                if (!m) m = html.match(/playlist\s*[:=]\s*(\[[\s\S]*?\])/);
                if (m) {
                    callback(parsePlaylistJson(m[1]));
                } else {
                    var links = extractVideoLinks(html);
                    callback(links.length ? [{ name: "Основна", qualities: links }] : []);
                }
            }, error);
        },
    };

    // Карта парсерів
    var PARSERS = {
        ashdi:     Ashdi,
        eneyida:   Eneyida,
        uakino:    UAKino,
        uaserials: UASerials,
        kinotron:  Kinotron,
        kinokrad:  KinoKrad,
    };

    // ============================================================
    //  UI — відображення озвучок і якості
    // ============================================================

    function showQualitySelect(qualities, onSelect) {
        var items = qualities.map(function (q) {
            return {
                title:  q.quality || "auto",
                quality: q,
            };
        });
        Lampa.Select.show({
            title: Lampa.Lang.translate("ua_online_select_qual"),
            items: items,
            onSelect: function (item) {
                onSelect(item.quality);
            },
            onBack: function () {
                Lampa.Controller.toggle("content");
            },
        });
    }

    function showVoiceSelect(voices, onSelect) {
        var items = voices.map(function (v) {
            return {
                title: v.name,
                voice: v,
            };
        });
        Lampa.Select.show({
            title: Lampa.Lang.translate("ua_online_select_voice"),
            items: items,
            onSelect: function (item) {
                onSelect(item.voice);
            },
            onBack: function () {
                Lampa.Controller.toggle("content");
            },
        });
    }

    // Запустити відео
    function playVideo(url, type, title) {
        Lampa.Player.play({
            url:   url,
            title: title || PLUGIN_NAME,
            type:  type || "hls",
        });
        Lampa.Player.playlist([{ url: url, title: title || PLUGIN_NAME }]);
    }

    // Вибір озвучки → якості → запуск
    function selectAndPlay(voices, title) {
        if (!voices || !voices.length) {
            Lampa.Noty.show(Lampa.Lang.translate("ua_online_no_results"));
            return;
        }

        var startPlay = function (voice) {
            var qualities = voice.qualities || [];
            if (!qualities.length) {
                Lampa.Noty.show(Lampa.Lang.translate("ua_online_no_results"));
                return;
            }
            if (qualities.length === 1) {
                playVideo(qualities[0].url, qualities[0].type, title);
            } else {
                showQualitySelect(qualities, function (q) {
                    playVideo(q.url, q.type, title);
                });
            }
        };

        if (voices.length === 1) {
            startPlay(voices[0]);
        } else {
            showVoiceSelect(voices, startPlay);
        }
    }

    // ============================================================
    //  Серіали — вибір сезону / серії
    // ============================================================

    function showSerialEpisodes(serialData, siteKey, id, title) {
        if (!serialData || !serialData.seasons || !serialData.seasons.length) {
            // формат без сезонів
            if (Array.isArray(serialData)) {
                selectAndPlay(serialData, title);
            } else {
                Lampa.Noty.show(Lampa.Lang.translate("ua_online_no_results"));
            }
            return;
        }

        var seasons = serialData.seasons;

        var seasonItems = seasons.map(function (s, i) {
            return {
                title: Lampa.Lang.translate("ua_online_season") + " " + (s.number || (i + 1)),
                season: s,
            };
        });

        Lampa.Select.show({
            title:  title + " — " + Lampa.Lang.translate("ua_online_season"),
            items:  seasonItems,
            onSelect: function (seasonItem) {
                var episodes = seasonItem.season.episodes || [];
                if (!episodes.length) {
                    Lampa.Noty.show(Lampa.Lang.translate("ua_online_no_results"));
                    return;
                }
                var episodeItems = episodes.map(function (ep, i) {
                    return {
                        title:   Lampa.Lang.translate("ua_online_episode") + " " + (ep.number || (i + 1)),
                        episode: ep,
                    };
                });
                Lampa.Select.show({
                    title:  seasonItem.title,
                    items:  episodeItems,
                    onSelect: function (epItem) {
                        var voices = epItem.episode.voices || epItem.episode.translations || [];
                        selectAndPlay(voices, title + " — " + seasonItem.title + " — " + epItem.title);
                    },
                    onBack: function () {
                        Lampa.Controller.toggle("content");
                    },
                });
            },
            onBack: function () {
                Lampa.Controller.toggle("content");
            },
        });
    }

    // ============================================================
    //  Вибір джерела (сайту) і завантаження
    // ============================================================

    function showSiteResults(results, card) {
        if (!results || !results.length) {
            Lampa.Noty.show(Lampa.Lang.translate("ua_online_no_results"));
            return;
        }

        var items = results.map(function (r) {
            return {
                title:   "[" + (SITES[r.source] ? SITES[r.source].name : r.source) + "] " + r.title + (r.year ? " (" + r.year + ")" : ""),
                result:  r,
            };
        });

        Lampa.Select.show({
            title:  card.name || card.title || PLUGIN_NAME,
            items:  items,
            onSelect: function (item) {
                var r       = item.result;
                var parser  = PARSERS[r.source];
                if (!parser) return;

                Lampa.Noty.show(Lampa.Lang.translate("ua_online_loading"));

                parser.getPlaylist(r.id || r.href, r.type, function (voices) {
                    if (r.type === "serial") {
                        // перевіряємо формат
                        var first = voices[0];
                        if (first && first.seasons) {
                            showSerialEpisodes(first, r.source, r.id, r.title);
                        } else {
                            selectAndPlay(voices, r.title);
                        }
                    } else {
                        selectAndPlay(voices, r.title);
                    }
                }, function () {
                    Lampa.Noty.show(Lampa.Lang.translate("ua_online_err_load"));
                });
            },
            onBack: function () {
                Lampa.Controller.toggle("content");
            },
        });
    }

    // ============================================================
    //  Основний потік: пошук по всіх сайтах
    // ============================================================

    function searchAllSites(query, card, callback) {
        var sites   = enabledSites();
        if (!sites.length) {
            callback([]);
            return;
        }

        var allResults = [];
        var pending    = sites.length;

        sites.forEach(function (key) {
            var parser = PARSERS[key];
            if (!parser) { pending--; if (!pending) callback(allResults); return; }

            parser.search({ query: query, page: 1 }, function (results) {
                allResults = allResults.concat(results);
                pending--;
                if (!pending) callback(allResults);
            }, function () {
                pending--;
                if (!pending) callback(allResults);
            });
        });
    }

    // ============================================================
    //  Source/Provider для Lampa
    // ============================================================

    function UAOnlineSource() {
        var self = this;
        this.results = [];
    }

    UAOnlineSource.prototype = {
        // Ініціалізація через картку
        start: function (card) {
            var self    = this;
            var title   = card.name || card.title || card.original_title || "";
            var year    = (card.release_date || card.first_air_date || "").slice(0, 4);
            var query   = year ? title + " " + year : title;

            Lampa.Noty.show(Lampa.Lang.translate("ua_online_loading"));

            searchAllSites(query, card, function (results) {
                self.results = results;
                if (!results.length) {
                    Lampa.Noty.show(Lampa.Lang.translate("ua_online_no_results"));
                    return;
                }
                showSiteResults(results, card);
            });
        },

        // Зупинка джерела
        stop: function () {
            this.results = [];
        },
    };

    // ============================================================
    //  Реєстрація у Lampa
    // ============================================================

    function registerSource() {
        // Додаємо кнопку через Listener — працює в усіх версіях Lampa
        Lampa.Listener.follow("full", function (e) {
            if (e.type !== "complite") return;

            var movie = e.data.movie || e.data;
            var btns  = e.object.activity.render().find(".full-start__buttons");
            if (!btns.length) return;

            // Не дублювати кнопку
            if (btns.find(".ua-online-btn").length) return;

            var btn = $('<div class="full-start__button ua-online-btn" style="cursor:pointer;">')
                .text("🇺🇦 " + PLUGIN_NAME);

            btn.on("click", function () {
                new UAOnlineSource().start(movie);
            });

            btns.prepend(btn);
        });

        // Також реєструємо як Source якщо API доступне
        if (typeof Lampa.Source !== "undefined" && Lampa.Source.add) {
            Lampa.Source.add(PLUGIN_ID, {
                name:   PLUGIN_NAME,
                create: function () { return new UAOnlineSource(); },
            });
        }

        if (typeof Lampa.Providers !== "undefined" && Lampa.Providers.register) {
            Lampa.Providers.register({
                name:  PLUGIN_NAME,
                id:    PLUGIN_ID,
                start: function (card) { new UAOnlineSource().start(card); },
            });
        }
    }

    // ============================================================
    //  Налаштування плагіна
    // ============================================================

    function registerSettings() {
        if (typeof Lampa.SettingsApi === "undefined") return;

        Lampa.SettingsApi.addComponent({
            component: PLUGIN_ID + "_settings",
            icon: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="3" stroke="#fff" stroke-width="2"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>',
            name: translate({ uk: "UA Online", ru: "UA Online", en: "UA Online" }),
        });

        // Перемикачі для кожного сайту
        Object.keys(SITES).forEach(function (key) {
            var site = SITES[key];
            Lampa.SettingsApi.addParam({
                component: PLUGIN_ID + "_settings",
                param: {
                    name:  PLUGIN_ID + "_site_" + key,
                    type:  "toggle",
                    default: true,
                },
                field: {
                    name:    site.name,
                    picture: "",
                },
                onChange: function (value) {
                    Lampa.Storage.set(PLUGIN_ID + "_site_" + key, value);
                },
            });
        });
    }

    // ============================================================
    //  Запуск
    // ============================================================

    function startPlugin() {
        registerSource();
        registerSettings();
        console.log("[" + PLUGIN_NAME + "] v" + VERSION + " loaded");
    }

    if (window.appready) {
        startPlugin();
    } else {
        Lampa.Listener.follow("app", function (e) {
            if (e.type === "ready") startPlugin();
        });
    }

})();
