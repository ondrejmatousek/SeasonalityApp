(() => {
    const root = document.querySelector('.seasonality-page');
    if (!root) return;
    const byId = id => document.getElementById(id);
    const panel = byId('market-cot-view');
    const seasonality = byId('market-seasonality-view');
    const status = byId('cot-status');
    const content = byId('cot-content');
    const tooltip = byId('cot-chart-tooltip');
    const history = byId('cot-history');
    const lookback = byId('cot-lookback');
    const retry = byId('cot-retry');
    const tabs = [...root.querySelectorAll('[data-market-tab]')];
    const groups = [
        { key: 'nonReportable', name: 'Malí obchodníci', color: '#f28aa8', chart: 'cot-small-chart' },
        { key: 'commercial', name: 'Komerční obchodníci', color: '#24dfcf', chart: 'cot-commercial-chart' },
        { key: 'nonCommercial', name: 'Velcí spekulanti', color: '#7098ff', chart: 'cot-large-chart' }
    ];
    const cache = new Map();
    let asset = JSON.parse(byId('seasonality-assets').textContent)[0];
    let payload = null;
    let currency = null;
    let request = null;
    let points = [];
    const number = value => value == null ? '—' : new Intl.NumberFormat('cs-CZ').format(value);
    const signed = value => value == null ? '—' : `${value > 0 ? '+' : ''}${number(value)}`;
    const dateLabel = value => new Date(`${value}T00:00:00Z`).toLocaleDateString('cs-CZ', { timeZone: 'UTC' });
    const element = (tag, text, className) => {
        const node = document.createElement(tag);
        if (text != null) node.textContent = text;
        if (className) node.className = className;
        return node;
    };
    const market = () => payload?.markets.find(item => item.key === currency);

    function switchTab(tab) {
        const cotActive = tab.dataset.marketTab === 'cot';
        tabs.forEach(button => {
            const active = button === tab;
            button.classList.toggle('is-active', active);
            button.setAttribute('aria-selected', String(active));
            button.tabIndex = active ? 0 : -1;
        });
        panel.hidden = !cotActive;
        seasonality.hidden = cotActive;
        tooltip.hidden = true;
        if (cotActive) load();
        else root.dispatchEvent(new CustomEvent('seasonality-visible'));
    }
    tabs.forEach(tab => {
        tab.onclick = () => switchTab(tab);
        tab.onkeydown = event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const index = tabs.indexOf(tab);
            const next = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs[tabs.length - 1]
                : tabs[(index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
            next.focus();
            switchTab(next);
        };
    });

    async function load(force = false) {
        if (!asset || panel.hidden) return;
        const key = `${asset.key}:${lookback.value}`;
        request?.abort();
        request = new AbortController();
        const currentRequest = request;
        payload = null;
        points = [];
        tooltip.hidden = true;
        byId('cot-asset-title').textContent = `COT · ${asset.name}`;
        byId('cot-report-meta').textContent = 'CFTC Legacy · Futures Only';
        byId('cot-market-switch').replaceChildren();
        byId('cot-market-note').textContent = '';
        content.hidden = true;
        status.textContent = 'Načítám COT reporty…';
        status.classList.remove('is-error');
        retry.hidden = true;
        panel.setAttribute('aria-busy', 'true');
        try {
            if (!force && cache.has(key)) payload = cache.get(key);
            else {
                const url = new URL(root.dataset.cotUrl, window.location.href);
                url.searchParams.set('assetKey', asset.key);
                url.searchParams.set('lookbackWeeks', lookback.value);
                const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: currentRequest.signal });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const data = await response.json();
                if (currentRequest !== request) return;
                payload = data;
                cache.set(key, data);
            }
            if (!payload.markets.some(item => item.key === currency))
                currency = (payload.markets.find(item => !item.isDollarIndex) || payload.markets[0])?.key;
            render();
        } catch (error) {
            if (error.name === 'AbortError' || currentRequest !== request) return;
            status.textContent = 'COT data se nepodařilo načíst. Zkus to znovu.';
            status.classList.add('is-error');
            retry.hidden = false;
        } finally {
            if (currentRequest === request) panel.setAttribute('aria-busy', 'false');
        }
    }

    function render() {
        if (!payload) return;
        byId('cot-market-note').textContent = payload.note || '';
        const switcher = byId('cot-market-switch');
        switcher.replaceChildren();
        payload.markets.forEach(item => {
            const button = element('button', `${item.isDollarIndex ? 'DXY / USD' : item.key} · ${item.name}`);
            button.type = 'button';
            button.setAttribute('aria-pressed', String(item.key === currency));
            button.classList.toggle('is-active', item.key === currency);
            button.onclick = () => { currency = item.key; tooltip.hidden = true; render(); };
            switcher.append(button);
        });
        const selectedMarket = market();
        if (!selectedMarket) {
            status.textContent = 'COT není pro tento instrument v aplikaci dostupné. Vyber hlavní forexový pár nebo DXY.';
            content.hidden = true;
            retry.hidden = true;
            return;
        }
        const reports = selectedMarket.reports;
        if (!reports.length) {
            status.textContent = 'Historie COT zatím není v databázi. Načte ji automatická aktualizace po pushi nebo denní běh. Potom zkus načíst data znovu.';
            content.hidden = true;
            retry.hidden = false;
            return;
        }
        retry.hidden = true;
        const latest = reports[reports.length - 1];
        const ageDays = Math.floor((Date.now() - Date.parse(`${latest.date}T00:00:00Z`)) / 86400000);
        byId('cot-report-meta').textContent = `${payload.reportType} · ${selectedMarket.name} · CFTC ${selectedMarket.contractCode} · pozice k ${dateLabel(latest.date)}`;
        status.textContent = ageDays > 14 ? `Poslední report je starý ${ageDays} dní. Zkontroluj aktualizaci dat nebo zveřejnění CFTC.` : '';
        content.hidden = false;
        const cutoff = new Date(`${latest.date}T00:00:00Z`);
        cutoff.setUTCFullYear(cutoff.getUTCFullYear() - Number(history.value));
        points = history.value === 'all' ? reports : reports.filter(row => Date.parse(`${row.date}T00:00:00Z`) >= cutoff.getTime());
        renderSummary(latest);
        draw();
        const table = byId('cot-report-table');
        table.replaceChildren();
        // Keep a long history usable without adding thousands of DOM rows at once.
        [...points].reverse().slice(0, 260).forEach(row => {
            const tr = element('tr');
            [dateLabel(row.date), signed(row.nonReportable.net), signed(row.nonReportable.change),
                signed(row.commercial.net), signed(row.commercial.change), signed(row.nonCommercial.net),
                signed(row.nonCommercial.change), number(row.openInterest)].forEach(value => tr.append(element('td', value)));
            table.append(tr);
        });
    }

    function renderSummary(latest) {
        const summary = byId('cot-summary');
        summary.replaceChildren();
        groups.forEach(group => {
            const position = latest[group.key];
            const card = element('article', null, 'cot-summary-card');
            card.append(element('h3', group.name));
            const values = element('div', null, 'cot-summary-values');
            const donut = element('div', null, 'cot-donut');
            const total = position.long + position.short + position.spread;
            donut.style.setProperty('--long', `${total ? 100 * position.long / total : 0}%`);
            donut.style.setProperty('--short', `${total ? 100 * (position.long + position.short) / total : 0}%`);
            if (!total) donut.style.background = '#566575';
            donut.setAttribute('role', 'img');
            donut.setAttribute('aria-label', `Long ${number(position.long)}, short ${number(position.short)}, spread ${number(position.spread)}`);
            const net = element('div');
            net.append(element('strong', signed(position.net)), element('p', 'čisté pozice (kontrakty)'),
                element('p', `Δ týdně ${signed(position.change)}`));
            values.append(donut, net);
            card.append(values);
            const dl = element('dl');
            [['Long', number(position.long)], ['Short', number(position.short)],
                ['COT index', position.index == null ? '—' : `${number(position.index)} / 100`]].forEach(([label, value]) => {
                dl.append(element('dt', label), element('dd', value));
            });
            if (group.key === 'nonCommercial') dl.append(element('dt', 'Spread'), element('dd', number(position.spread)));
            card.append(dl, element('footer', 'Zelená: long · růžová: short · šedá: spread. Podíly uvedených pozic skupiny, nikoli celého trhu.'));
            summary.append(card);
        });
    }

    function chart(canvas, indexChart = false, group = null) {
        const width = Math.max(280, canvas.getBoundingClientRect().width);
        const height = 260;
        const ratio = window.devicePixelRatio || 1;
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
        const context = canvas.getContext('2d');
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        const pad = { left: 62, right: 18, top: 14, bottom: 32 };
        const w = width - pad.left - pad.right, h = height - pad.top - pad.bottom;
        if (!points.length) return;
        const values = indexChart ? [0, 100] : points.flatMap(row => [row[group.key].net, row[group.key].change ?? 0]);
        let min = Math.min(0, ...values), max = Math.max(0, ...values);
        if (min === max) { min -= 1; max += 1; }
        if (!indexChart) { const margin = (max - min) * .12; min -= margin; max += margin; }
        const first = Date.parse(points[0].date), last = Date.parse(points[points.length - 1].date);
        const x = row => pad.left + (last === first ? .5 : (Date.parse(row.date) - first) / (last - first)) * w;
        const y = value => pad.top + (max - value) / (max - min) * h;
        context.font = '11px sans-serif';
        context.lineWidth = 1;
        const ticks = indexChart ? [0, 20, 40, 60, 80, 100] : Array.from({ length: 5 }, (_, i) => min + (max - min) * i / 4);
        ticks.forEach(value => {
            context.strokeStyle = indexChart && [20, 80].includes(value) ? '#7098ff88' : '#ffffff13';
            context.beginPath(); context.moveTo(pad.left, y(value)); context.lineTo(width - pad.right, y(value)); context.stroke();
            context.fillStyle = '#8794a4'; context.textAlign = 'right';
            context.fillText(indexChart ? String(value) : Intl.NumberFormat('cs-CZ', { notation: 'compact', maximumFractionDigits: 1 }).format(value), pad.left - 9, y(value) + 4);
        });
        if (indexChart) {
            context.fillStyle = '#f28aa80b'; context.fillRect(pad.left, y(100), w, y(80) - y(100));
            context.fillStyle = '#24dfcf0b'; context.fillRect(pad.left, y(20), w, y(0) - y(20));
        } else {
            context.strokeStyle = '#ffffff45'; context.beginPath(); context.moveTo(pad.left, y(0)); context.lineTo(width - pad.right, y(0)); context.stroke();
            const barWidth = Math.max(1, Math.min(14, w * 604800000 / Math.max(last - first, 604800000) * .65));
            context.fillStyle = `${group.color}75`;
            points.forEach(row => {
                const change = row[group.key].change;
                if (change == null) return;
                context.fillRect(x(row) - barWidth / 2, Math.min(y(0), y(change)), barWidth, Math.max(1, Math.abs(y(change) - y(0))));
            });
        }
        const line = (field, color, indexed) => {
            context.strokeStyle = color; context.lineWidth = 1.7; context.beginPath();
            let started = false;
            let previousDate = null;
            points.forEach(row => {
                const value = row[field][indexed ? 'index' : 'net'];
                const timestamp = Date.parse(row.date);
                if (previousDate != null && timestamp - previousDate > 10 * 86400000) started = false;
                previousDate = timestamp;
                if (value == null) { started = false; return; }
                if (started) context.lineTo(x(row), y(value)); else context.moveTo(x(row), y(value));
                started = true;
            });
            context.stroke();
            // A single report should still be visible.
            if (points.length === 1) {
                const value = points[0][field][indexed ? 'index' : 'net'];
                if (value != null) { context.fillStyle = color; context.beginPath(); context.arc(x(points[0]), y(value), 3, 0, 2 * Math.PI); context.fill(); }
            }
        };
        if (indexChart) groups.forEach(item => line(item.key, item.color, true));
        else line(group.key, group.color, false);
        context.fillStyle = '#8794a4'; context.textAlign = 'center';
        const count = width < 500 ? 3 : 6;
        for (let i = 0; i < count; i++) {
            const position = i / (count - 1);
            const date = new Date(first + (last - first) * position);
            context.fillText(date.toLocaleDateString('cs-CZ', { month: 'short', year: '2-digit', timeZone: 'UTC' }), pad.left + position * w, height - 8);
        }
        canvas.onpointermove = event => {
            const rect = canvas.getBoundingClientRect();
            const fraction = Math.max(0, Math.min(1, (event.clientX - rect.left - pad.left) / w));
            const timestamp = first + fraction * (last - first);
            const row = points.reduce((a, b) => Math.abs(Date.parse(a.date) - timestamp) < Math.abs(Date.parse(b.date) - timestamp) ? a : b);
            const text = indexChart
                ? groups.map(item => `${item.name}: ${row[item.key].index == null ? '—' : number(row[item.key].index)}`).join('\n')
                : `${group.name}\nNet: ${signed(row[group.key].net)} kontraktů\nΔ týdně: ${signed(row[group.key].change)}\nLong: ${number(row[group.key].long)} · Short: ${number(row[group.key].short)}`;
            tooltip.textContent = `${market().key} · pozice k ${dateLabel(row.date)}\n${text}`;
            tooltip.hidden = false;
            tooltip.style.left = `${Math.max(8, Math.min(event.clientX + 14, window.innerWidth - tooltip.offsetWidth - 8))}px`;
            tooltip.style.top = `${Math.max(8, Math.min(event.clientY + 14, window.innerHeight - tooltip.offsetHeight - 8))}px`;
        };
        canvas.onpointerleave = () => { tooltip.hidden = true; };
    }

    function draw() {
        if (panel.hidden || content.hidden) return;
        groups.forEach(group => chart(byId(group.chart), false, group));
        chart(byId('cot-index-chart'), true);
    }
    root.addEventListener('asset-change', event => {
        if (event.detail?.key === asset?.key) return;
        asset = event.detail;
        request?.abort();
        tooltip.hidden = true;
        load();
    });
    history.onchange = render;
    lookback.onchange = () => load();
    retry.onclick = () => load(true);
    new ResizeObserver(draw).observe(panel);
})();
