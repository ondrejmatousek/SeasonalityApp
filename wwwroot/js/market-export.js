(() => {
    const root = document.querySelector('.seasonality-page');
    if (!root) return;
    const buttons = [...root.querySelectorAll('[data-export-view]')];
    const status = document.getElementById('market-export-status');
    const wrap = root.querySelector('.seasonality-wrap');
    let library;
    let exporting = false;
    const loadLibrary = () => {
        if (window.html2canvas) return Promise.resolve(window.html2canvas);
        if (!library) library = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = root.dataset.captureUrl;
            script.onload = () => resolve(window.html2canvas);
            script.onerror = () => { script.remove(); library = null; reject(new Error('PNG renderer unavailable')); };
            document.head.append(script);
        });
        return library;
    };
    async function capture(button) {
        if (exporting || button.disabled) return;
        exporting = true;
        buttons.forEach(item => item.setAttribute('aria-busy', 'true'));
        status.textContent = 'Vytvářím PNG…';
        // Lock the view while it is cloned, so the header and charts cannot belong
        // to different instruments if the user changes the selection mid-export.
        const controls = [...wrap.querySelectorAll('button, input, select')];
        const previousStates = controls.map(item => item.disabled);
        controls.forEach(item => { item.disabled = true; });
        try {
            const renderer = await loadLibrary();
            await document.fonts.ready;
            const rect = wrap.getBoundingClientRect();
            const isScreener=button.dataset.exportView==='screener';
            const image = await renderer(wrap, {
                backgroundColor: '#0b0f11', logging: false,
                scale: window.MarketChartUi.exportScale(rect.width, isScreener ? 2400 : rect.height),
                onclone: doc => {
                    if (isScreener) {
                        const rows=[...doc.querySelectorAll('#screener-results tr')];
                        rows.slice(20).forEach(row=>row.remove());
                        const note=doc.createElement('p');note.textContent=`PNG: ${Math.min(rows.length,20)} z ${rows.length} výsledků v aktuálním řazení. Historické výsledky nejsou předpovědí.`;
                        doc.querySelector('#market-screener-view').append(note);
                        const tableWrap=doc.querySelector('.screener-table-wrap');tableWrap.style.overflow='visible';
                        const captureWidth=Math.max(rect.width, root.querySelector('.screener-table').scrollWidth);
                        doc.querySelector('.seasonality-wrap').style.width=captureWidth+'px';
                        doc.querySelector('.seasonality-wrap').style.maxWidth='none';
                        // Native number inputs can clip their values in html2canvas.
                        // Use readable text in the PNG without changing live filters.
                        doc.querySelectorAll('#market-screener-view input, #market-screener-view select').forEach(control=>{
                            const value=doc.createElement('span');
                            value.textContent=control.tagName==='SELECT' ? control.selectedOptions[0]?.textContent || '—'
                                : `${control.type==='number'?control.placeholder+': ':''}${control.value || '—'}`;
                            value.style.cssText='display:block;padding:6px 8px;border:1px solid #ffffff24;border-radius:4px;background:#252b2e;color:#e5e9ee;font-size:12px;white-space:nowrap';
                            control.replaceWith(value);
                        });
                    }
                    // Capture the complete analysis, including charts below the
                    // current scroll position, but not navigation/hover popovers/tables.
                    for (const selector of ['body', '.app-workspace', '.app-workspace-main']) {
                        const element = doc.querySelector(selector);
                        element.style.height = 'auto';
                        element.style.overflow = 'visible';
                        element.scrollTop = 0;
                    }
                    doc.querySelectorAll('[data-export-omit], [data-export-view], .seasonality-tooltip, .seasonality-drag-preview, .seasonality-chart-help-popover').forEach(item => item.remove());
                    // html2canvas otherwise paints form controls from collapsed
                    // <details> even though the browser does not show their content.
                    doc.querySelectorAll('details:not([open])').forEach(item => {
                        [...item.children].filter(child => child.tagName !== 'SUMMARY').forEach(child => child.remove());
                    });
                    doc.querySelectorAll('summary').forEach(item => { item.style.listStyle = 'none'; });
                    // Disabled is only a guard on the live controls; export normal styling.
                    doc.querySelectorAll('button, input, select').forEach(item => { item.disabled = false; });
                }
            });
            // Add a small border around the crop without resizing the source DOM
            // or altering the proportions of its already-rendered chart canvases.
            const padding = 24;
            const framed = document.createElement('canvas');
            framed.width = image.width + padding * 2;
            framed.height = image.height + padding * 2;
            const context = framed.getContext('2d');
            context.fillStyle = '#0b0f11'; context.fillRect(0, 0, framed.width, framed.height);
            context.drawImage(image, padding, padding);
            const blob = await new Promise((resolve, reject) => framed.toBlob(result => result ? resolve(result) : reject(new Error('Empty PNG')), 'image/png'));
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            const asset = isScreener ? 'Trhy' : root.dataset.assetKey || 'instrument';
            const view = isScreener ? 'Screener' : button.dataset.exportView === 'cot' ? `COT-${root.dataset.cotMarket || asset}`
                : document.getElementById('seasonality-monthly-view').hidden ? 'Seasonality' : 'Seasonality-monthly';
            const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Prague' }).format(new Date());
            link.download = window.MarketChartUi.pngFilename(asset, view, date);
            link.href = url;
            document.body.append(link);
            link.click();
            link.remove();
            // Leave time for the browser to start consuming the object URL.
            window.setTimeout(() => URL.revokeObjectURL(url), 60000);
            status.textContent = 'PNG je připravené ke stažení.';
        } catch (error) {
            status.textContent = 'PNG se nepodařilo vytvořit. Zkus to znovu nebo obnov stránku.';
            console.error('Chart PNG export failed', error);
        } finally {
            controls.forEach((item, index) => { item.disabled = previousStates[index]; });
            buttons.forEach(item => item.removeAttribute('aria-busy'));
            exporting = false;
        }
    }
    buttons.forEach(button => { button.onclick = () => capture(button); });
})();
