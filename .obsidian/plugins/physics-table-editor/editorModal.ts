import { App, Modal, Notice, TFile } from "obsidian";
import { CellCoord, HtmlTableCell, HtmlTableData, HorizontalAlign, VerticalAlign } from "./tableTypes";
import { createCell, createCoveredCell, formatHtmlTable, normalizeCssSize, replaceHtmlTableRange } from "./renderTable";

interface HtmlTableEditorModalOptions {
	app: App;
	data: HtmlTableData;
	sourcePath: string;
	sourceRange: { start: number; end: number };
	onSaved: () => void;
}

type Rect = {
	top: number;
	left: number;
	bottom: number;
	right: number;
};

const HORIZONTAL_ALIGNMENTS: HorizontalAlign[] = ["left", "center", "right"];
const VERTICAL_ALIGNMENTS: VerticalAlign[] = ["top", "middle", "bottom"];

export class HtmlTableEditorModal extends Modal {
	private data: HtmlTableData;
	private readonly sourcePath: string;
	private readonly sourceRange: { start: number; end: number };
	private readonly onSaved: () => void;
	private selectionAnchor: CellCoord = { row: 0, col: 0 };
	private selectionFocus: CellCoord = { row: 0, col: 0 };

	constructor(options: HtmlTableEditorModalOptions) {
		super(options.app);
		this.data = cloneData(options.data);
		this.normalizeMatrix();
		this.sourcePath = options.sourcePath;
		this.sourceRange = options.sourceRange;
		this.onSaved = options.onSaved;
	}

	onOpen(): void {
		this.render();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private render(): void {
		this.contentEl.empty();
		this.titleEl.setText("编辑表格");
		this.modalEl.addClass("pt-table-modal");

		const root = this.contentEl.createDiv({ cls: "pt-table-modal-root" });
		const toolbar = root.createDiv({ cls: "pt-table-modal-toolbar" });

		this.createTextField(toolbar, "表格宽度", this.data.tableWidth, (value) => {
			this.data.tableWidth = normalizeCssSize(value || "100%");
		});
		this.createButton(toolbar, "加行", () => this.addRow());
		this.createButton(toolbar, "删行", () => this.deleteSelectedRow());
		this.createButton(toolbar, "加列", () => this.addColumn());
		this.createButton(toolbar, "删列", () => this.deleteSelectedColumn());

		if (this.canMergeSelection()) {
			this.createButton(toolbar, "合并单元格", () => this.mergeSelection()).addClass("mod-cta");
		}
		if (this.canUnmerge()) {
			this.createButton(toolbar, "取消合并", () => this.unmergeSelectedCell());
		}

		const body = root.createDiv({ cls: "pt-table-modal-body" });
		this.renderEditorTable(body);
		this.renderSidePanel(body);

		const footer = root.createDiv({ cls: "pt-table-modal-footer" });
		this.createButton(footer, "取消", () => this.close());
		this.createButton(footer, "保存", () => {
			void this.save();
		}).addClass("mod-cta");
	}

	private renderEditorTable(parent: HTMLElement): void {
		const wrap = parent.createDiv({ cls: "pt-table-editor-wrap" });
		const table = wrap.createEl("table", { cls: "pt-table-editor-grid" });

		const colgroup = table.createEl("colgroup");
		colgroup.createEl("col", { cls: "pt-table-row-label-col" });
		for (let colIndex = 0; colIndex < this.colCount(); colIndex += 1) {
			const col = colgroup.createEl("col");
			col.style.width = this.data.colWidths[colIndex] || "160px";
		}

		const thead = table.createEl("thead");
		const headerRow = thead.createEl("tr");
		headerRow.createEl("th", { text: "" });
		for (let colIndex = 0; colIndex < this.colCount(); colIndex += 1) {
			const th = headerRow.createEl("th", { text: columnLabel(colIndex) });
			th.toggleClass("is-selected", this.isColumnSelected(colIndex));
			th.addEventListener("click", () => this.selectColumn(colIndex));
		}

		const tbody = table.createEl("tbody");
		for (let rowIndex = 0; rowIndex < this.data.rows.length; rowIndex += 1) {
			const row = this.data.rows[rowIndex];
			const tr = tbody.createEl("tr");
			const rowHeader = tr.createEl("th", { text: String(rowIndex + 1) });
			rowHeader.toggleClass("is-selected", this.isRowSelected(rowIndex));
			rowHeader.addEventListener("click", () => this.selectRow(rowIndex));

			for (let colIndex = 0; colIndex < row.length; colIndex += 1) {
				const cell = row[colIndex];
				if (cell.covered) {
					continue;
				}

				const td = tr.createEl("td");
				if (cell.colspan > 1) {
					td.colSpan = cell.colspan;
				}
				if (cell.rowspan > 1) {
					td.rowSpan = cell.rowspan;
				}
				td.toggleClass("is-selected", this.isCellSelected(rowIndex, colIndex));
				td.style.textAlign = cell.align ?? "";
				td.style.verticalAlign = cell.valign ?? "";
				td.addEventListener("click", (event) => this.selectCell(rowIndex, colIndex, event.shiftKey));

				const textarea = td.createEl("textarea");
				textarea.value = cell.text;
				textarea.addEventListener("input", () => {
					cell.text = textarea.value;
				});
			}
		}
	}

	private renderSidePanel(parent: HTMLElement): void {
		const panel = parent.createDiv({ cls: "pt-table-side-panel" });
		const rect = this.selectionRect();
		const selected = this.selectedCell();

		panel.createEl("h3", {
			text: rect.top === rect.bottom && rect.left === rect.right
				? `单元格 ${rect.top + 1}, ${rect.left + 1}`
				: `选区 ${rect.top + 1}:${rect.left + 1} - ${rect.bottom + 1}:${rect.right + 1}`,
		});

		this.createTextField(panel, `第 ${this.selectionFocus.col + 1} 列宽`, this.data.colWidths[this.selectionFocus.col] ?? "160px", (value) => {
			this.data.colWidths[this.selectionFocus.col] = normalizeCssSize(value || "160px");
			this.render();
		});

		this.createSelect(panel, "水平对齐", HORIZONTAL_ALIGNMENTS, selected.align ?? "", (value) => {
			this.applyToSelectedCells((cell) => {
				cell.align = value === "" ? undefined : value as HorizontalAlign;
			});
			this.render();
		}, true);

		this.createSelect(panel, "垂直对齐", VERTICAL_ALIGNMENTS, selected.valign ?? "", (value) => {
			this.applyToSelectedCells((cell) => {
				cell.valign = value === "" ? undefined : value as VerticalAlign;
			});
			this.render();
		}, true);

		panel.createDiv({
			cls: "pt-table-help",
			text: "提示：点击一个单元格，再按住 Shift 点击另一个单元格，可选择矩形区域并合并。",
		});
	}

	private async save(): Promise<void> {
		try {
			const file = this.app.vault.getAbstractFileByPath(this.sourcePath);
			if (!(file instanceof TFile)) {
				throw new Error(`Cannot find source file: ${this.sourcePath}`);
			}

			this.normalizeMatrix();
			const markdown = await this.app.vault.read(file);
			const nextHtml = formatHtmlTable(this.data);
			const nextMarkdown = replaceHtmlTableRange(markdown, this.sourceRange, nextHtml);
			await this.app.vault.modify(file, nextMarkdown);
			this.onSaved();
			this.close();
			new Notice("HTML table saved.");
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			new Notice(`Save failed: ${message}`);
			console.error(error);
		}
	}

	private selectCell(row: number, col: number, extend: boolean): void {
		if (extend) {
			this.selectionFocus = { row, col };
		} else {
			this.selectionAnchor = { row, col };
			this.selectionFocus = { row, col };
		}
		this.render();
	}

	private selectRow(row: number): void {
		this.selectionAnchor = { row, col: 0 };
		this.selectionFocus = { row, col: this.colCount() - 1 };
		this.render();
	}

	private selectColumn(col: number): void {
		this.selectionAnchor = { row: 0, col };
		this.selectionFocus = { row: this.data.rows.length - 1, col };
		this.render();
	}

	private addRow(): void {
		this.data.rows.push(Array.from({ length: this.colCount() }, () => createCell("")));
		this.render();
	}

	private deleteSelectedRow(): void {
		if (this.data.rows.length <= 1) {
			return;
		}
		if (this.rowIntersectsSpan(this.selectionRect().top)) {
			new Notice("请先取消该行经过的合并单元格。");
			return;
		}
		this.data.rows.splice(this.selectionRect().top, 1);
		this.clampSelection();
		this.normalizeMatrix();
		this.render();
	}

	private addColumn(): void {
		for (const row of this.data.rows) {
			row.push(createCell(""));
		}
		this.data.colWidths.push("160px");
		this.render();
	}

	private deleteSelectedColumn(): void {
		if (this.colCount() <= 1) {
			return;
		}
		const col = this.selectionRect().left;
		if (this.columnIntersectsSpan(col)) {
			new Notice("请先取消该列经过的合并单元格。");
			return;
		}
		for (const row of this.data.rows) {
			row.splice(col, 1);
		}
		this.data.colWidths.splice(col, 1);
		this.clampSelection();
		this.normalizeMatrix();
		this.render();
	}

	private canMergeSelection(): boolean {
		const rect = this.selectionRect();
		if (rect.top === rect.bottom && rect.left === rect.right) {
			return false;
		}
		for (let row = rect.top; row <= rect.bottom; row += 1) {
			for (let col = rect.left; col <= rect.right; col += 1) {
				const cell = this.data.rows[row][col];
				if (cell.covered || cell.colspan > 1 || cell.rowspan > 1) {
					return false;
				}
			}
		}
		return true;
	}

	private mergeSelection(): void {
		if (!this.canMergeSelection()) {
			return;
		}

		const rect = this.selectionRect();
		const anchor = this.data.rows[rect.top][rect.left];
		anchor.colspan = rect.right - rect.left + 1;
		anchor.rowspan = rect.bottom - rect.top + 1;
		for (let row = rect.top; row <= rect.bottom; row += 1) {
			for (let col = rect.left; col <= rect.right; col += 1) {
				if (row === rect.top && col === rect.left) {
					continue;
				}
				this.data.rows[row][col] = createCoveredCell();
			}
		}
		this.selectionAnchor = { row: rect.top, col: rect.left };
		this.selectionFocus = { row: rect.top, col: rect.left };
		this.render();
	}

	private canUnmerge(): boolean {
		const cell = this.selectedCell();
		return !cell.covered && (cell.colspan > 1 || cell.rowspan > 1);
	}

	private unmergeSelectedCell(): void {
		const rect = this.selectionRect();
		const cell = this.selectedCell();
		if (!this.canUnmerge()) {
			return;
		}

		for (let row = rect.top; row < rect.top + cell.rowspan; row += 1) {
			for (let col = rect.left; col < rect.left + cell.colspan; col += 1) {
				if (row === rect.top && col === rect.left) {
					continue;
				}
				this.data.rows[row][col] = createCell("");
			}
		}
		cell.colspan = 1;
		cell.rowspan = 1;
		this.render();
	}

	private selectedCell(): HtmlTableCell {
		return this.data.rows[this.selectionFocus.row][this.selectionFocus.col];
	}

	private applyToSelectedCells(callback: (cell: HtmlTableCell) => void): void {
		const rect = this.selectionRect();
		for (let row = rect.top; row <= rect.bottom; row += 1) {
			for (let col = rect.left; col <= rect.right; col += 1) {
				const cell = this.data.rows[row][col];
				if (!cell.covered) {
					callback(cell);
				}
			}
		}
	}

	private rowIntersectsSpan(rowIndex: number): boolean {
		for (let row = 0; row < this.data.rows.length; row += 1) {
			for (let col = 0; col < this.colCount(); col += 1) {
				const cell = this.data.rows[row][col];
				if (!cell.covered && cell.rowspan > 1 && rowIndex >= row && rowIndex < row + cell.rowspan) {
					return true;
				}
			}
		}
		return false;
	}

	private columnIntersectsSpan(colIndex: number): boolean {
		for (let row = 0; row < this.data.rows.length; row += 1) {
			for (let col = 0; col < this.colCount(); col += 1) {
				const cell = this.data.rows[row][col];
				if (!cell.covered && cell.colspan > 1 && colIndex >= col && colIndex < col + cell.colspan) {
					return true;
				}
			}
		}
		return false;
	}

	private selectionRect(): Rect {
		return {
			top: Math.min(this.selectionAnchor.row, this.selectionFocus.row),
			left: Math.min(this.selectionAnchor.col, this.selectionFocus.col),
			bottom: Math.max(this.selectionAnchor.row, this.selectionFocus.row),
			right: Math.max(this.selectionAnchor.col, this.selectionFocus.col),
		};
	}

	private isCellSelected(row: number, col: number): boolean {
		const rect = this.selectionRect();
		return row >= rect.top && row <= rect.bottom && col >= rect.left && col <= rect.right;
	}

	private isRowSelected(row: number): boolean {
		const rect = this.selectionRect();
		return row >= rect.top && row <= rect.bottom && rect.left === 0 && rect.right === this.colCount() - 1;
	}

	private isColumnSelected(col: number): boolean {
		const rect = this.selectionRect();
		return col >= rect.left && col <= rect.right && rect.top === 0 && rect.bottom === this.data.rows.length - 1;
	}

	private normalizeMatrix(): void {
		const cols = this.colCount();
		this.data.colWidths = Array.from({ length: cols }, (_, index) => normalizeCssSize(this.data.colWidths[index] ?? "160px"));
		this.data.rows = this.data.rows.length > 0 ? this.data.rows : [Array.from({ length: cols }, () => createCell(""))];
		for (const row of this.data.rows) {
			for (let col = 0; col < cols; col += 1) {
				row[col] ??= createCell("");
			}
			row.length = cols;
		}
	}

	private colCount(): number {
		return Math.max(this.data.colWidths.length, ...this.data.rows.map((row) => row.length), 1);
	}

	private clampSelection(): void {
		const row = Math.min(this.selectionFocus.row, this.data.rows.length - 1);
		const col = Math.min(this.selectionFocus.col, this.colCount() - 1);
		this.selectionAnchor = { row, col };
		this.selectionFocus = { row, col };
	}

	private createButton(parent: HTMLElement, text: string, onClick: () => void): HTMLButtonElement {
		const button = parent.createEl("button", { text });
		button.type = "button";
		button.addEventListener("click", onClick);
		return button;
	}

	private createTextField(parent: HTMLElement, labelText: string, value: string, onChange: (value: string) => void): void {
		const label = parent.createEl("label", { cls: "pt-table-field" });
		label.createSpan({ text: labelText });
		const input = label.createEl("input", { type: "text" });
		input.value = value;
		input.addEventListener("change", () => onChange(input.value));
	}

	private createSelect(parent: HTMLElement, labelText: string, values: string[], currentValue: string, onChange: (value: string) => void, allowEmpty = false): void {
		const label = parent.createEl("label", { cls: "pt-table-field" });
		label.createSpan({ text: labelText });
		const select = label.createEl("select");
		if (allowEmpty) {
			select.createEl("option", { text: "", value: "" });
		}
		for (const value of values) {
			const option = select.createEl("option", { text: value, value });
			option.selected = value === currentValue;
		}
		select.addEventListener("change", () => onChange(select.value));
	}
}

function cloneData(data: HtmlTableData): HtmlTableData {
	return JSON.parse(JSON.stringify(data)) as HtmlTableData;
}

function columnLabel(index: number): string {
	let n = index + 1;
	let label = "";
	while (n > 0) {
		const remainder = (n - 1) % 26;
		label = String.fromCharCode(65 + remainder) + label;
		n = Math.floor((n - 1) / 26);
	}
	return label;
}
