/**
 * Left-edge panel listing all lines with their official colour swatch.
 * Click a line to highlight it (dim others); click again to clear highlight.
 * Eye-icon toggles visibility of that line's polyline + trains.
 */

export class LinePanel {
    constructor(container, lines, {onHighlight, onToggleVisible}) {
        this.lines = lines;
        this._highlightId = null;
        this._visible = new Set(lines.map(l => l.id));
        this.onHighlight = onHighlight;
        this.onToggleVisible = onToggleVisible;

        this.el = document.createElement('div');
        this.el.className = 'm3d-line-panel';
        this.el.innerHTML = `
            <div class="m3d-panel-title">深圳地铁 · 线路</div>
            <ul class="m3d-line-list"></ul>
        `;
        container.appendChild(this.el);
        this._list = this.el.querySelector('.m3d-line-list');
        this._render();
    }

    _render() {
        this._list.innerHTML = '';
        for (const line of this.lines) {
            const li = document.createElement('li');
            li.className = 'm3d-line-row';
            if (this._highlightId === line.id) li.classList.add('is-active');
            if (!this._visible.has(line.id)) li.classList.add('is-hidden');
            li.innerHTML = `
                <span class="m3d-line-swatch" style="background:${line.color}">${line.code}</span>
                <span class="m3d-line-name">${line.nameZh}</span>
                <button class="m3d-line-eye" title="显示/隐藏">●</button>
            `;
            li.addEventListener('click', e => {
                if (e.target.classList.contains('m3d-line-eye')) {
                    if (this._visible.has(line.id)) this._visible.delete(line.id);
                    else this._visible.add(line.id);
                    this.onToggleVisible?.(line.id, this._visible.has(line.id));
                    this._render();
                    return;
                }
                this._highlightId = this._highlightId === line.id ? null : line.id;
                this.onHighlight?.(this._highlightId);
                this._render();
            });
            this._list.appendChild(li);
        }
    }
}
