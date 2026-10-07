(() => {
    const root = document.querySelector('.seasonality-page');
    if (!root) return;
    const chartGeometry = window.SeasonalityChartGeometry;

    let data = JSON.parse(document.querySelector('#seasonality-data').textContent);
    const assets = JSON.parse(document.querySelector('#seasonality-assets').textContent);
    const assetSearch = document.querySelector('#seasonality-asset-search');
    const assetLoading = document.querySelector('#seasonality-asset-loading');
    const assetSuggestions = document.querySelector('#seasonality-asset-suggestions');
    const assetStatus = document.querySelector('#seasonality-asset-status');
    const years = document.querySelector('#seasonality-years');
    const list = document.querySelector('#seasonality-year-list');
    const canvas = document.querySelector('#seasonality-canvas');
    const dragPreview = document.querySelector('#seasonality-drag-preview');
    const ctx = canvas.getContext('2d');
    const returnsCanvas = document.querySelector('#seasonality-returns-canvas');
    const cumulativeCanvas = document.querySelector('#seasonality-cumulative-canvas');
    const monthlyCanvas = document.querySelector('#seasonality-monthly-canvas');
    const monthlyYears = document.querySelector('#seasonality-monthly-years');
    const monthlyTable = document.querySelector('#seasonality-monthly-table');
    const monthlySummary = document.querySelector('#seasonality-monthly-summary');
    const monthlySubtitle = document.querySelector('#seasonality-monthly-subtitle');
    const tooltip = document.querySelector('#seasonality-tooltip');
    const startDateInput = document.querySelector('#seasonality-start-date');
    const endDateInput = document.querySelector('#seasonality-end-date');
    const intervalLabel = document.querySelector('#seasonality-interval-label');
    const intervalMetrics = document.querySelector('#seasonality-interval-metrics');
    const selected = new Set();
    let trend = null;
    let cycle = null;
    let election = null;
    let pollTimer = null;
    let interval = null;
    let dragStart = null;
    let dragPointerId = null;
    let hoverDay = null;
    let activeAsset = assets[0];
    let assetSearchTimer = null;
    let highlightedAssetIndex = 0;
    let visibleAssetSuggestions = [];
    let loadingAssetKey = null;
    const loadedAssets = new Set();
    const failedAssets = new Set();

    const normalizeSearch = value => value.toLowerCase().replace(/[^a-z0-9]+/g, '');
    const rows = () => activeAsset ? data[activeAsset.key] || [] : [];
    const matchingAssets = value => {
        const term = normalizeSearch(value);
        if (!term) return assets.slice(0, 8);
        const scored = assets
            .map(item => {
                const key = normalizeSearch(item.key);
                const name = normalizeSearch(item.name);
                const aliases = (item.aliases || []).map(normalizeSearch);
                const exact = key === term || name === term || aliases.includes(term);
                const starts = key.startsWith(term) || name.startsWith(term) || aliases.some(alias => alias.startsWith(term));
                const includes = key.includes(term) || name.includes(term) || aliases.some(alias => alias.includes(term));
                return { item, score: exact ? 0 : starts ? 1 : includes ? 2 : 3 };
            })
            .filter(match => match.score < 3)
            .sort((a, b) => a.score - b.score || a.item.name.localeCompare(b.item.name));
        return scored.slice(0, 8).map(match => match.item);
    };
    const findAsset = value => {
        const term = normalizeSearch(value);
        if (!term) return activeAsset;
        return matchingAssets(value)[0];
    };
    const setAssetSearchLoading = isLoading => {
        assetLoading.classList.toggle('is-visible', isLoading);
        assetSearch.setAttribute('aria-busy', String(isLoading));
    };
    const updateAssetStatus = () => {
        if (!activeAsset) {
            assetStatus.textContent = 'Asset nenalezen';
            return;
        }
        const status = rows().length ? `${rows().length} záznamů`
            : failedAssets.has(activeAsset.key) ? 'načtení selhalo'
            : loadedAssets.has(activeAsset.key) ? 'data nejsou v databázi' : 'data se načítají';
        assetStatus.textContent = `${activeAsset.name} · ${status}`;
    };
    const setSyncStatus = (isUpdating, error) => {
        document.querySelector('#seasonality-sync-status').textContent = isUpdating
            ? 'Aktualizace dat probíhá na pozadí…'
            : error ? `Aktualizace se nepodařila: ${error}` : '';
    };
    function refreshActiveViews() {
        document.querySelector('#market-instrument-title').textContent = activeAsset?.name || 'Instrument';
        rebuild();
        if (!document.querySelector('#seasonality-monthly-view').hidden) drawMonthly();
        root.dispatchEvent(new CustomEvent('asset-change', { detail: activeAsset }));
    }
    async function loadAssetData(asset) {
        if (!asset || rows().length && activeAsset?.key === asset.key) return;

        const assetKey = asset.key;
        failedAssets.delete(assetKey);
        loadingAssetKey = assetKey;
        root.classList.add('is-loading');
        setAssetSearchLoading(true);
        updateAssetStatus();

        try {
            const url = new URL(root.dataset.dataUrl, window.location.href);
            url.searchParams.set('assetKey', assetKey);
            const response = await fetch(url, { headers: { Accept: 'application/json' } });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const payload = await response.json();
            const payloadKey = payload.assetKey || assetKey;
            data[payloadKey] = payload.prices || [];
            loadedAssets.add(payloadKey);
            if (activeAsset?.key === payloadKey) {
                setSyncStatus(Boolean(payload.isUpdating), payload.error);
                root.classList.toggle('is-loading', Boolean(payload.isUpdating && !rows().length));
                updateAssetStatus();
                refreshActiveViews();
                if (payload.isUpdating && !rows().length) {
                    window.clearTimeout(pollTimer);
                    pollTimer = window.setTimeout(() => loadAssetData(asset), 4000);
                }
            }
        } catch (error) {
            if (activeAsset?.key === assetKey) {
                failedAssets.add(assetKey);
                root.classList.remove('is-loading');
                updateAssetStatus();
                document.querySelector('#seasonality-sync-status').textContent = 'Data se nepodařilo načíst. Zkus asset vyhledat znovu nebo obnov stránku.';
                window.clearTimeout(pollTimer);
            }
        } finally {
            if (loadingAssetKey === assetKey) {
                loadingAssetKey = null;
                setAssetSearchLoading(false);
            }
        }
    }
    const hideAssetSuggestions = () => {
        assetSuggestions.hidden = true;
        assetSearch.setAttribute('aria-expanded', 'false');
    };
    const renderAssetSuggestions = () => {
        visibleAssetSuggestions = matchingAssets(assetSearch.value);
        highlightedAssetIndex = Math.min(highlightedAssetIndex, Math.max(visibleAssetSuggestions.length - 1, 0));
        assetSuggestions.innerHTML = '';
        if (!visibleAssetSuggestions.length) {
            const empty = document.createElement('div');
            empty.className = 'seasonality-asset-suggestion-empty';
            empty.textContent = 'Žádný asset neodpovídá hledání';
            assetSuggestions.append(empty);
            assetSuggestions.hidden = false;
            assetSearch.setAttribute('aria-expanded', 'true');
            return;
        }
        visibleAssetSuggestions.forEach((item, index) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'seasonality-asset-suggestion';
            button.setAttribute('role', 'option');
            button.setAttribute('aria-selected', String(index === highlightedAssetIndex));
            button.dataset.assetKey = item.key;
            const key = document.createElement('strong');
            key.textContent = item.key;
            const name = document.createElement('span');
            name.textContent = item.name;
            button.append(key, name);
            button.onmousedown = event => event.preventDefault();
            button.onclick = () => selectAsset(item);
            assetSuggestions.append(button);
        });
        assetSuggestions.hidden = false;
        assetSearch.setAttribute('aria-expanded', 'true');
    };
    const selectAsset = next => {
        if (!next) return;
        window.clearTimeout(assetSearchTimer);
        setAssetSearchLoading(false);
        const changed = !activeAsset || next.key !== activeAsset.key;
        activeAsset = next;
        assetSearch.value = next.name;
        updateAssetStatus();
        hideAssetSuggestions();
        if (changed) {
            setSyncStatus(false, null);
            root.classList.toggle('is-loading', !rows().length);
            refreshActiveViews();
            loadAssetData(next);
        }
    };
    const applyAssetSearch = (showSuggestions = false) => {
        const next = findAsset(assetSearch.value);
        setAssetSearchLoading(false);
        if (!next) {
            assetStatus.textContent = 'Asset nenalezen';
            return;
        }
        const changed = !activeAsset || next.key !== activeAsset.key;
        activeAsset = next;
        updateAssetStatus();
        if (showSuggestions) renderAssetSuggestions();
        if (changed) {
            setSyncStatus(false, null);
            root.classList.toggle('is-loading', !rows().length);
            refreshActiveViews();
            loadAssetData(next);
        } else if (!rows().length) {
            loadAssetData(next);
        }
    };
    const electionType = year => year % 4 === 0
        ? 'election'
        : year % 4 === 1 ? 'post' : year % 4 === 2 ? 'midterm' : 'pre';
    const yearTrend = year => {
        const values = rows()
            .filter(row => new Date(row.date).getFullYear() === year)
            .sort((a, b) => a.date.localeCompare(b.date));
        return values.length && values[values.length - 1].close >= values[0].close
            ? 'bullish'
            : 'bearish';
    };
    const filtered = () => rows().filter(row => {
        const year = new Date(row.date).getFullYear();
        return selected.has(year)
            && (!trend || yearTrend(year) === trend)
            && (!cycle || (year % 2 === 0 ? 'even' : 'odd') === cycle)
            && (!election || electionType(year) === election);
    });

    const calendarDay = value => {
        const date = new Date(value);
        const start = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
        let day = Math.floor((date - start) / 86400000);
        if (new Date(Date.UTC(date.getUTCFullYear(), 1, 29)).getUTCMonth() === 1 && day > 59) day -= 1;
        return day;
    };
    const dateForDay = day => {
        const year = new Date().getUTCFullYear();
        const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
        const date = new Date(Date.UTC(year, 0, 1 + day + (isLeapYear && day >= 59 ? 1 : 0)));
        return date.toISOString().slice(0, 10);
    };
    const inputInterval = () => {
        if (!startDateInput.value || !endDateInput.value) return null;
        const startDay = calendarDay(`${startDateInput.value}T00:00:00Z`);
        const endDay = calendarDay(`${endDateInput.value}T00:00:00Z`);
        return startDay <= endDay ? { startDay, endDay } : { startDay: endDay, endDay: startDay };
    };
    const intervalYearStats = byYear => {
        if (!interval) return [];
        const result = [];
        byYear.forEach(yearRows => {
            yearRows.sort((a, b) => a.date.localeCompare(b.date));
            const startIndex = yearRows.findIndex(row => calendarDay(row.date) >= interval.startDay);
            const endIndex = yearRows.findIndex(row => calendarDay(row.date) >= interval.endDay);
            const first = yearRows[startIndex < 0 ? 0 : startIndex];
            const last = yearRows[endIndex < 0 ? yearRows.length - 1 : endIndex];
            if (!first || !last || first.date >= last.date) return;
            const slice = yearRows.slice(yearRows.indexOf(first), yearRows.indexOf(last) + 1);
            const base = first.close;
            result.push({
                year: new Date(first.date).getUTCFullYear(),
                start: first.date,
                end: last.date,
                returnPct: last.close / base * 100 - 100,
                maxRise: Math.max(...slice.map(row => row.close / base * 100)) - 100,
                maxDrop: Math.min(...slice.map(row => row.close / base * 100)) - 100
            });
        });
        return result;
    };

    const rebuild = () => {
        const availableYears = [...new Set(rows().map(row => new Date(row.date).getFullYear()))]
            .sort((a, b) => b - a);
        const visibleYears = years.value === 'all' ? availableYears : availableYears.slice(0, Number(years.value));
        selected.clear();
        visibleYears.forEach(year => selected.add(year));
        list.innerHTML = visibleYears.map(year =>
            `<label><input type="checkbox" value="${year}" checked> ${year}</label>`).join('');
        list.querySelectorAll('input').forEach(input => input.onchange = () => {
            input.checked ? selected.add(Number(input.value)) : selected.delete(Number(input.value));
            draw();
        });
        if (trend || cycle || election) {
            selectYears();
        } else {
            syncActiveButtons();
            draw();
        }
    };

    const syncYearChecks = () => list.querySelectorAll('input').forEach(input => {
        input.checked = selected.has(Number(input.value));
    });

    const syncActiveButtons = () => {
        root.querySelectorAll('[data-trend]').forEach(button => button.classList.toggle('is-active', trend === button.dataset.trend));
        root.querySelectorAll('[data-cycle]').forEach(button => button.classList.toggle('is-active', cycle === button.dataset.cycle));
        root.querySelectorAll('[data-election]').forEach(button => button.classList.toggle('is-active', election === button.dataset.election));
    };

    const selectYears = () => {
        const availableYears = [...list.querySelectorAll('input')].map(input => Number(input.value));
        selected.clear();
        availableYears.filter(year => (!trend || yearTrend(year) === trend)
            && (!cycle || (year % 2 === 0 ? 'even' : 'odd') === cycle)
            && (!election || electionType(year) === election))
            .forEach(year => selected.add(year));
        syncYearChecks();
        syncActiveButtons();
        draw();
    };

    function draw() {
        const byYear = new Map();
        filtered().forEach(row => {
            const year = new Date(row.date).getFullYear();
            if (!byYear.has(year)) byYear.set(year, []);
            byYear.get(year).push(row);
        });

        const grouped = new Map();
        const yearStats = [];
        byYear.forEach(yearRows => {
            yearRows.sort((a, b) => a.date.localeCompare(b.date));
            const base = yearRows[0].close;
            const last = yearRows[yearRows.length - 1].close;
            const high = Math.max(...yearRows.map(row => row.close / base * 100)) - 100;
            const low = Math.min(...yearRows.map(row => row.close / base * 100)) - 100;
            yearStats.push({
                year: new Date(yearRows[0].date).getFullYear(),
                start: yearRows[0].date,
                end: yearRows[yearRows.length - 1].date,
                returnPct: last / base * 100 - 100,
                maxRise: high,
                maxDrop: low
            });

            // Seasonality is aligned to the calendar day, not to each year's
            // nth trading session. Missing weekends/holidays are interpolated.
            const daily = yearRows.map(row => {
                const date = new Date(row.date);
                const start = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
                let day = Math.floor((date - start) / 86400000);
                const leap = new Date(Date.UTC(date.getUTCFullYear(), 1, 29)).getUTCMonth() === 1;
                if (leap && day > 59) day -= 1;
                return { day, value: row.close / base * 100 };
            });
            for (let day = 0; day < 365; day++) {
                const exact = daily.find(item => item.day === day);
                let value = exact?.value;
                if (value === undefined) {
                    const before = [...daily].reverse().find(item => item.day < day);
                    const after = daily.find(item => item.day > day);
                    if (before && after) {
                        const ratio = (day - before.day) / (after.day - before.day);
                        value = before.value + (after.value - before.value) * ratio;
                    } else {
                        value = before?.value ?? after?.value;
                    }
                }
                if (value !== undefined) {
                    if (!grouped.has(day)) grouped.set(day, []);
                    grouped.get(day).push(value);
                }
            }
        });

        const rawPoints = [...grouped]
            .sort((a, b) => a[0] - b[0])
            .map(([day, values]) => [day, values.reduce((sum, value) => sum + value, 0) / values.length]);
        const points = rawPoints;
        const selectedIntervalStats = intervalYearStats(byYear);
        const rect = canvas.getBoundingClientRect();
        const width = Math.max(280, rect.width);
        const height = rect.height || 380;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);
        const hasPrices = rows().length > 0;
        const missingPrices = !hasPrices && activeAsset && loadedAssets.has(activeAsset.key) && !failedAssets.has(activeAsset.key);
        document.querySelector('#seasonality-title').textContent = activeAsset
            ? missingPrices ? `${activeAsset.name} · ${activeAsset.key} — data nejsou v databázi` : `${activeAsset.name} · ${activeAsset.key}`
            : 'Asset';
        document.querySelector('#seasonality-subtitle').textContent = missingPrices
            ? 'Pro toto aktivum nejsou v Azure SQL uloženy ceny.'
            : `${selected.size} vybraných let · průměr podle obchodních dnů · index 100 = začátek roku`;
        if (!points.length) {
            ctx.fillStyle = '#8794a4';
            ctx.font = '14px sans-serif';
            const emptyMessage = root.classList.contains('is-loading') ? 'Načítám historická data…'
                : failedAssets.has(activeAsset?.key) ? 'Ceny se nepodařilo načíst.'
                : missingPrices ? `${activeAsset.name} (${activeAsset.key}): data nejsou v databázi.`
                : 'Pro zvolené filtry nejsou k dispozici žádná data.';
            ctx.fillText(emptyMessage, 36, 60);
            updateStats([], [], 0);
            return;
        }

        const min = Math.min(...points.map(point => point[1]));
        const max = Math.max(...points.map(point => point[1]));
        const range = Math.max(max - min, 1);
        const chartMin = Math.floor((min - range * .08) * 10) / 10;
        const chartMax = Math.ceil((max + range * .08) * 10) / 10;
        const plot = chartGeometry.forWidth(width);
        const pad = plot.left;
        const bottom = height - 42;
        const xFor = day => chartGeometry.xFor(width, day);
        const yFor = value => pad + (chartMax - value) / (chartMax - chartMin) * (bottom - pad);
        ctx.strokeStyle = 'rgba(255,255,255,.12)';
        ctx.fillStyle = '#8794a4';
        ctx.font = '12px sans-serif';
        for (let index = 0; index < 5; index++) {
            const y = pad + (bottom - pad) * index / 4;
            ctx.beginPath();
            ctx.moveTo(pad, y);
            ctx.lineTo(plot.right, y);
            ctx.stroke();
            ctx.fillText((chartMax - (chartMax - chartMin) * index / 4).toFixed(1), 4, y + 4);
        }

        if (chartMin <= 100 && chartMax >= 100) {
            const baseline = yFor(100);
            ctx.save();
            ctx.setLineDash([5, 5]);
            ctx.strokeStyle = 'rgba(255,255,255,.28)';
            ctx.beginPath();
            ctx.moveTo(pad, baseline);
            ctx.lineTo(plot.right, baseline);
            ctx.stroke();
            ctx.restore();
        }

        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        ctx.fillStyle = '#8794a4';
        months.forEach((month, index) => {
            const x = chartGeometry.xFor(width, index / 12 * plot.lastDay);
            if (width >= 480 || index % 2 === 0) ctx.fillText(month, x, height - 10);
            ctx.strokeStyle = 'rgba(255,255,255,.06)';
            ctx.beginPath();
            ctx.moveTo(x, pad);
            ctx.lineTo(x, bottom);
            ctx.stroke();
        });

        if (interval) {
            const startX = xFor(interval.startDay);
            const endX = xFor(interval.endDay);
            ctx.fillStyle = 'rgba(36,223,207,.07)';
            ctx.fillRect(startX, pad, Math.max(endX - startX, 2), bottom - pad);
            ctx.save();
            ctx.strokeStyle = 'rgba(220,227,233,.9)';
            ctx.lineWidth = 1.5;
            [startX, endX].forEach(x => {
                ctx.beginPath();
                ctx.moveTo(x, pad);
                ctx.lineTo(x, bottom);
                ctx.stroke();
            });
            ctx.restore();
        }

        ctx.strokeStyle = '#24dfcf';
        ctx.lineWidth = 2;
        ctx.beginPath();
        points.forEach((point, index) => {
            const x = xFor(point[0]);
            const y = yFor(point[1]);
            index ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        });
        ctx.stroke();

        updateStats(points, selectedIntervalStats.length ? selectedIntervalStats : yearStats, selected.size);
    }

    function updateStats(points, yearStats, yearCount) {
        const end = points.length ? points[points.length - 1][1] - 100 : 0;
        const high = points.length ? Math.max(...points.map(point => point[1])).toFixed(1) : '-';
        const returns = yearStats.map(item => item.returnPct);
        const average = returns.length ? returns.reduce((sum, value) => sum + value, 0) / returns.length : 0;
        const sorted = [...returns].sort((a, b) => a - b);
        const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
        const winRate = returns.length ? returns.filter(value => value > 0).length / returns.length * 100 : 0;
        document.querySelector('#seasonality-stats').innerHTML =
            `<div><strong>${end.toFixed(2)} %</strong><span>${interval ? 'průměrný výnos intervalu' : 'průměrný výnos období'}</span></div>`
            + `<div><strong>${yearCount}</strong><span>vybraných let</span></div>`
            + `<div><strong>${average.toFixed(2)} %</strong><span>průměrný roční výnos</span></div>`
            + `<div><strong>${median.toFixed(2)} %</strong><span>medián ročního výnosu</span></div>`
            + `<div><strong>${winRate.toFixed(1)} %</strong><span>win rate roků</span></div>`
            + `<div><strong>${high}</strong><span>maximální index</span></div>`;
        drawReturns(yearStats);
        const cumulativePoints = interval
            ? points.filter(point => point[0] >= interval.startDay && point[0] <= interval.endDay)
                .map(point => [point[0], point[1] - (points.find(item => item[0] === interval.startDay)?.[1] ?? 100) + 100])
            : points;
        drawCumulative(cumulativePoints);
        updateIntervalCard(yearStats);
        document.querySelector('#seasonality-year-table').innerHTML = [...yearStats]
            .sort((a, b) => b.year - a.year)
            .map(item => `<tr><td>${item.year}</td><td>${formatDate(item.start)}</td><td>${formatDate(item.end)}</td><td class="${item.returnPct >= 0 ? 'positive' : 'negative'}">${formatPct(item.returnPct)}</td><td class="positive">${formatPct(item.maxRise)}</td><td class="negative">${formatPct(item.maxDrop)}</td></tr>`).join('');
    }

    function updateIntervalCard(stats) {
        if (!interval) {
            intervalLabel.textContent = 'Interval není vybraný';
            intervalMetrics.innerHTML = '<span>Vyber interval tažením přes graf nebo pomocí data.</span>';
            return;
        }
        const returns = stats.map(item => item.returnPct);
        const wins = returns.filter(value => value > 0).length;
        const average = returns.length ? returns.reduce((sum, value) => sum + value, 0) / returns.length : 0;
        intervalLabel.textContent = `${formatDayLabel(interval.startDay)} – ${formatDayLabel(interval.endDay)}`;
        intervalMetrics.innerHTML = `<div><strong>${returns.length}</strong><span>roků</span></div><div><strong>${formatPct(average)}</strong><span>průměrný výnos</span></div><div><strong>${returns.length ? (wins / returns.length * 100).toFixed(1) : '0.0'} %</strong><span>win rate</span></div>`;
    }

    function formatDayLabel(day) {
        // Calendar-day indices omit February 29, so labels use a fixed non-leap year.
        return new Date(Date.UTC(2023, 0, 1 + day)).toLocaleDateString('cs-CZ', { day: '2-digit', month: '2-digit' });
    }

    function formatDate(value) {
        return new Date(value).toLocaleDateString('cs-CZ', { day: '2-digit', month: '2-digit' });
    }

    function formatPct(value) {
        return `${value >= 0 ? '+' : ''}${value.toFixed(2)} %`;
    }

    function monthlyStats() {
        const allRows = rows().slice().sort((a, b) => a.date.localeCompare(b.date));
        const availableYears = [...new Set(allRows.map(row => new Date(row.date).getUTCFullYear()))].sort((a, b) => b - a);
        const lookback = monthlyYears.value === 'all' ? availableYears.length : Number(monthlyYears.value);
        const selectedYears = new Set(availableYears.slice(0, lookback));
        const stats = Array.from({ length: 12 }, (_, month) => ({ month, values: [] }));
        allRows.filter(row => selectedYears.has(new Date(row.date).getUTCFullYear())).forEach(row => {
            const date = new Date(`${row.date}T00:00:00Z`);
            const bucket = stats[date.getUTCMonth()].values.find(item => item.year === date.getUTCFullYear());
            if (bucket) bucket.rows.push(row);
            else stats[date.getUTCMonth()].values.push({ year: date.getUTCFullYear(), rows: [row] });
        });
        const monthly = stats.map(item => ({ ...item, returns: item.values.map(value => {
            const sorted = value.rows.sort((a, b) => a.date.localeCompare(b.date));
            return { year: value.year, value: sorted.length > 1 ? sorted.at(-1).close / sorted[0].close * 100 - 100 : 0 };
        }) }));
        monthly.forEach(item => {
            if (item.returns.length !== 9 || item.returns.some(row => row.year === 2015)) return;
            const fallbackRows = allRows.filter(row => {
                const date = new Date(`${row.date}T00:00:00Z`);
                return date.getUTCFullYear() === 2015 && date.getUTCMonth() === item.month;
            }).sort((a, b) => a.date.localeCompare(b.date));
            if (fallbackRows.length > 1) {
                item.returns.push({ year: 2015, value: fallbackRows.at(-1).close / fallbackRows[0].close * 100 - 100 });
            }
        });
        return { selectedYears, stats: monthly };
    }

    function drawMonthly() {
        const { selectedYears, stats } = monthlyStats();
        const monthNames = ['Leden','Únor','Březen','Duben','Květen','Červen','Červenec','Srpen','Září','Říjen','Listopad','Prosinec'];
        const summaries = stats.map(item => {
            const values = item.returns.map(row => row.value);
            return { ...item, average: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0, wins: values.length ? values.filter(value => value > 0).length / values.length * 100 : 0 };
        });
        const valid = summaries.filter(item => item.returns.length);
        const average = valid.length ? valid.reduce((sum, item) => sum + item.average, 0) / valid.length : 0;
        const best = valid.length ? valid.reduce((a, b) => a.average > b.average ? a : b) : null;
        const worst = valid.length ? valid.reduce((a, b) => a.average < b.average ? a : b) : null;
        monthlySubtitle.textContent = `${selectedYears.size} let · měsíční změna mezi prvním a posledním obchodním dnem`;
        monthlySummary.innerHTML = `<div><strong>${selectedYears.size}</strong><span>vybraných let</span></div><div><strong>${formatPct(average)}</strong><span>průměr přes měsíce</span></div><div><strong>${best ? monthNames[best.month] : '-'}</strong><span>nejsilnější měsíc</span></div><div><strong>${worst ? monthNames[worst.month] : '-'}</strong><span>nejslabší měsíc</span></div>`;
        monthlyTable.innerHTML = summaries.map(item => {
            const bestYear = item.returns.length ? item.returns.reduce((a, b) => a.value > b.value ? a : b) : null;
            const worstYear = item.returns.length ? item.returns.reduce((a, b) => a.value < b.value ? a : b) : null;
            return `<tr><td>${monthNames[item.month]}</td><td class="${item.average >= 0 ? 'positive' : 'negative'}">${formatPct(item.average)}</td><td class="${item.wins >= 50 ? 'positive' : 'negative'}">${item.wins.toFixed(0)} %</td><td>${bestYear ? `${bestYear.year} (${formatPct(bestYear.value)})` : '<span class="muted">-</span>'}</td><td>${worstYear ? `${worstYear.year} (${formatPct(worstYear.value)})` : '<span class="muted">-</span>'}</td><td>${item.returns.length}</td></tr>`;
        }).join('');
        drawMonthlyChart(summaries);
    }

    function drawMonthlyChart(summaries) {
        const { context, width, height } = setupCanvas(monthlyCanvas, 430);
        const pad = { left: 44, right: 22, top: 24, bottom: 42 };
        const maxAbs = Math.max(...summaries.flatMap(item => [Math.abs(item.average), Math.abs(item.wins - 50) / 10]), 1);
        const scale = maxAbs * 1.15;
        const chartHeight = height - pad.top - pad.bottom;
        const baseline = pad.top + chartHeight / 2;
        const slot = (width - pad.left - pad.right) / 12;
        context.strokeStyle = 'rgba(255,255,255,.12)'; context.beginPath(); context.moveTo(pad.left, baseline); context.lineTo(width - pad.right, baseline); context.stroke();
        summaries.forEach((item, index) => {
            const x = pad.left + index * slot + slot * .18;
            const barWidth = slot * .58;
            const barHeight = item.average / scale * chartHeight / 2;
            context.fillStyle = item.average >= 0 ? '#24dfcf' : '#f28aa8';
            context.fillRect(x, barHeight >= 0 ? baseline - barHeight : baseline, barWidth, Math.abs(barHeight));
            const winY = pad.top + chartHeight - (item.wins / 100) * chartHeight;
            context.fillStyle = '#b99cff'; context.fillRect(x + barWidth * .35, winY - 3, barWidth * .3, 6);
            context.fillStyle = '#8794a4'; context.font = '11px sans-serif'; context.textAlign = 'center';
            context.fillText(['Led','Úno','Bře','Dub','Kvě','Čer','Čvc','Srp','Zář','Říj','Lis','Pro'][index], x + barWidth / 2, height - 14);
        });
        context.textAlign = 'left';
    }

    function setupCanvas(target, height = 220) {
        const rect = target.getBoundingClientRect();
        const width = Math.max(300, rect.width);
        const dpr = window.devicePixelRatio || 1;
        target.width = width * dpr;
        target.height = height * dpr;
        const context = target.getContext('2d');
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        context.clearRect(0, 0, width, height);
        return { context, width, height };
    }

    function drawReturns(yearStats) {
        const { context, width, height } = setupCanvas(returnsCanvas);
        if (!yearStats.length) return;
        const pad = 32;
        const max = Math.max(...yearStats.map(item => Math.abs(item.returnPct)), 1);
        const baseline = height / 2;
        context.strokeStyle = 'rgba(255,255,255,.12)';
        context.beginPath();
        context.moveTo(pad, baseline);
        context.lineTo(width - pad, baseline);
        context.stroke();
        const slot = (width - pad * 2) / yearStats.length;
        yearStats.sort((a, b) => a.year - b.year).forEach((item, index) => {
            const x = pad + index * slot + slot * .2;
            const barWidth = Math.max(4, slot * .6);
            const barHeight = Math.abs(item.returnPct) / max * (height / 2 - 28);
            context.fillStyle = item.returnPct >= 0 ? '#24dfcf' : '#f28aa8';
            context.fillRect(x, item.returnPct >= 0 ? baseline - barHeight : baseline, barWidth, barHeight);
            context.fillStyle = '#8794a4';
            context.font = '11px sans-serif';
            context.fillText(String(item.year).slice(2), x, height - 8);
        });
    }

    function drawCumulative(points) {
        const { context, width, height } = setupCanvas(cumulativeCanvas);
        if (!points.length) return;
        const pad = 32;
        const min = Math.min(...points.map(point => point[1]));
        const max = Math.max(...points.map(point => point[1]));
        context.strokeStyle = 'rgba(255,255,255,.12)';
        context.beginPath();
        context.moveTo(pad, height - pad);
        context.lineTo(width - pad, height - pad);
        context.stroke();
        context.strokeStyle = '#24dfcf';
        context.lineWidth = 2;
        context.beginPath();
        points.forEach((point, index) => {
            const x = pad + index / Math.max(points.length - 1, 1) * (width - pad * 2);
            const y = pad + (max - point[1]) / (max - min || 1) * (height - pad * 2);
            index ? context.lineTo(x, y) : context.moveTo(x, y);
        });
        context.stroke();
    }

    assetSearch.oninput = () => {
        window.clearTimeout(assetSearchTimer);
        highlightedAssetIndex = 0;
        setAssetSearchLoading(true);
        assetStatus.textContent = 'Hledám…';
        renderAssetSuggestions();
        assetSearchTimer = window.setTimeout(() => applyAssetSearch(true), 260);
    };
    assetSearch.onfocus = renderAssetSuggestions;
    assetSearch.onblur = () => window.setTimeout(hideAssetSuggestions, 120);
    assetSearch.onkeydown = event => {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            highlightedAssetIndex = Math.min(highlightedAssetIndex + 1, visibleAssetSuggestions.length - 1);
            renderAssetSuggestions();
            return;
        }
        if (event.key === 'ArrowUp') {
            event.preventDefault();
            highlightedAssetIndex = Math.max(highlightedAssetIndex - 1, 0);
            renderAssetSuggestions();
            return;
        }
        if (event.key === 'Escape') {
            hideAssetSuggestions();
            return;
        }
        if (event.key === 'Enter') {
            event.preventDefault();
            selectAsset(visibleAssetSuggestions[highlightedAssetIndex] || findAsset(assetSearch.value));
        }
    };
    years.onchange = rebuild;
    monthlyYears.onchange = drawMonthly;
    root.querySelectorAll('[data-seasonality-tab]').forEach(button => button.onclick = () => {
        const monthly = button.dataset.seasonalityTab === 'monthly';
        root.querySelectorAll('[data-seasonality-tab]').forEach(item => item.classList.toggle('is-active', item === button));
        document.querySelector('#seasonality-curve-view').hidden = monthly;
        document.querySelector('#seasonality-monthly-view').hidden = !monthly;
        if (monthly) drawMonthly();
    });
    document.querySelector('#seasonality-all').onclick = () => {
        list.querySelectorAll('input').forEach(input => {
            input.checked = true;
            selected.add(Number(input.value));
        });
        draw();
    };
    document.querySelector('#seasonality-none').onclick = () => {
        list.querySelectorAll('input').forEach(input => {
            input.checked = false;
            selected.delete(Number(input.value));
        });
        draw();
    };
    document.querySelector('#seasonality-reset').onclick = () => {
        trend = null;
        cycle = null;
        election = null;
        syncActiveButtons();
        rebuild();
    };
    root.querySelectorAll('[data-trend]').forEach(button => button.onclick = () => {
        trend = trend === button.dataset.trend ? null : button.dataset.trend;
        selectYears();
    });
    root.querySelectorAll('[data-cycle]').forEach(button => button.onclick = () => {
        cycle = cycle === button.dataset.cycle ? null : button.dataset.cycle;
        selectYears();
    });
    root.querySelectorAll('[data-election]').forEach(button => button.onclick = () => {
        const next = election === button.dataset.election ? null : button.dataset.election;
        election = next;
        selectYears();
    });

    const pointerDay = event => {
        const rect = canvas.getBoundingClientRect();
        return chartGeometry.dayForX(rect.width, event.clientX - rect.left);
    };
    const showDragPreview = endDay => {
        const rect = canvas.getBoundingClientRect();
        const startX = chartGeometry.xFor(rect.width, dragStart);
        const endX = chartGeometry.xFor(rect.width, endDay);
        dragPreview.style.left = `${canvas.offsetLeft + Math.min(startX, endX)}px`;
        dragPreview.style.top = `${canvas.offsetTop}px`;
        dragPreview.style.width = `${Math.max(Math.abs(endX - startX), 2)}px`;
        dragPreview.style.height = `${rect.height}px`;
        dragPreview.hidden = false;
    };
    const clearDragPreview = () => {
        dragStart = null;
        dragPointerId = null;
        dragPreview.hidden = true;
    };
    canvas.addEventListener('pointermove', event => {
        hoverDay = pointerDay(event);
        if (dragStart !== null && event.pointerId === dragPointerId) showDragPreview(hoverDay);
        tooltip.textContent = dragStart === null
            ? `${formatDayLabel(hoverDay)} · kalendářní den ${hoverDay + 1}`
            : `${formatDayLabel(Math.min(dragStart, hoverDay))} – ${formatDayLabel(Math.max(dragStart, hoverDay))}`;
        tooltip.style.left = `${Math.min(event.offsetX + 14, canvas.clientWidth - 190)}px`;
        tooltip.style.top = `${Math.max(event.offsetY - 36, 8)}px`;
        tooltip.classList.add('is-visible');
    });
    canvas.addEventListener('pointerleave', () => tooltip.classList.remove('is-visible'));
    canvas.addEventListener('pointerdown', event => {
        if (!event.isPrimary || event.button !== 0) return;
        event.preventDefault();
        dragStart = pointerDay(event);
        dragPointerId = event.pointerId;
        canvas.setPointerCapture(event.pointerId);
        showDragPreview(dragStart);
    });
    canvas.addEventListener('pointerup', event => {
        if (dragStart === null || event.pointerId !== dragPointerId) return;
        const dragEnd = pointerDay(event);
        interval = { startDay: Math.min(dragStart, dragEnd), endDay: Math.max(dragStart, dragEnd) };
        startDateInput.value = dateForDay(interval.startDay);
        endDateInput.value = dateForDay(interval.endDay);
        clearDragPreview();
        draw();
    });
    canvas.addEventListener('pointercancel', event => {
        if (event.pointerId === dragPointerId) clearDragPreview();
    });
    document.querySelector('#seasonality-apply-interval').onclick = () => {
        const next = inputInterval();
        if (!next) return;
        interval = next;
        draw();
    };
    document.querySelector('#seasonality-clear-interval').onclick = () => {
        interval = null;
        startDateInput.value = '';
        endDateInput.value = '';
        draw();
    };
    root.addEventListener('seasonality-visible', refreshActiveViews);
    new ResizeObserver(() => {
        if (document.querySelector('#market-seasonality-view').hidden) return;
        draw();
        if (!document.querySelector('#seasonality-monthly-view').hidden) drawMonthly();
    }).observe(canvas.parentElement);
    applyAssetSearch();
    rebuild();
    setSyncStatus(root.dataset.updating === 'true', null);
    root.classList.toggle('is-loading', root.dataset.updating === 'true' && !rows().length);
    if (activeAsset && !rows().length) loadAssetData(activeAsset);
})();
