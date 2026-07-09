import { MarkdownPostProcessorContext, MarkdownRenderer, MarkdownView, Notice, Plugin } from "obsidian";
import { HtmlTableEditorModal } from "./editorModal";
import {
	createDefaultHtmlTable,
	findPtTableRangeAroundLine,
	getRangeSource,
	parseHtmlTableElement,
	parseHtmlTableSource,
} from "./renderTable";

const PT_TABLE_STYLE_ID = "physics-table-editor-pt-table-style";
const PT_TABLE_CSS = `
.markdown-rendered table.pt-table,
.markdown-preview-view table.pt-table,
.mod-export-pdf table.pt-table,
.print table.pt-table,
.pdf-export table.pt-table,
body table.pt-table {
	width: 100% !important;
	border-collapse: collapse !important;
	table-layout: fixed !important;
	margin: 0.35em 0 0.55em !important;
	border: 1px solid #b8b8b8 !important;
	background: transparent !important;
	color: var(--text-normal, #000) !important;
	font-size: 0.88em !important;
	line-height: 1.35 !important;
	letter-spacing: normal !important;
}

.markdown-rendered table.pt-table td,
.markdown-rendered table.pt-table th,
.markdown-preview-view table.pt-table td,
.markdown-preview-view table.pt-table th,
.mod-export-pdf table.pt-table td,
.mod-export-pdf table.pt-table th,
.print table.pt-table td,
.print table.pt-table th,
.pdf-export table.pt-table td,
.pdf-export table.pt-table th,
body table.pt-table td,
body table.pt-table th {
	border: 1px solid #b8b8b8 !important;
	padding: 3px 6px !important;
	background: transparent !important;
	box-sizing: border-box !important;
	vertical-align: middle;
	white-space: normal !important;
	word-break: break-word !important;
	overflow-wrap: anywhere !important;
}

body table.pt-table .pt-left {
	text-align: left !important;
}

body table.pt-table .pt-center {
	text-align: center !important;
}

body table.pt-table .pt-right {
	text-align: right !important;
}

body table.pt-table .pt-vtop {
	vertical-align: top !important;
}

body table.pt-table .pt-vmiddle {
	vertical-align: middle !important;
}

body table.pt-table .pt-vbottom {
	vertical-align: bottom !important;
}

body table.pt-table .pt-bold {
	font-weight: 700 !important;
}

.markdown-rendered table.pt-table p,
.markdown-preview-view table.pt-table p,
body table.pt-table p {
	margin: 0 !important;
	line-height: inherit !important;
}

.markdown-rendered table.pt-table mjx-container,
.markdown-preview-view table.pt-table mjx-container,
body table.pt-table mjx-container,
body table.pt-table .math {
	margin: 0 !important;
	font-size: 1em !important;
	line-height: 1 !important;
}

@media print {
	body table.pt-table {
		width: 100% !important;
		max-width: 100% !important;
		border-collapse: collapse !important;
		table-layout: fixed !important;
		color: var(--text-normal, #000) !important;
		background: transparent !important;
		font-size: 9.5pt !important;
		line-height: 1.35 !important;
		page-break-inside: avoid;
	}

	body table.pt-table td,
	body table.pt-table th {
		border: 0.75pt solid #999 !important;
		padding: 3pt 5pt !important;
		background: transparent !important;
		color: var(--text-normal, #000) !important;
		vertical-align: middle !important;
		box-sizing: border-box !important;
		white-space: normal !important;
		word-break: break-all !important;
		overflow-wrap: anywhere !important;
	}

	body table.pt-table p {
		margin: 0 !important;
	}

	body table.pt-table mjx-container {
		margin: 0 !important;
	}
}
`;

export default class PhysicsTableEditorPlugin extends Plugin {
	async onload(): Promise<void> {
		this.injectPtTableCss();
		this.registerDomEvent(window, "beforeprint", () => {
			this.injectPtTableCss();
		});

		this.addCommand({
			id: "insert-physics-table",
			name: "Insert 3x3 Physics Table",
			editorCallback: (editor) => {
				editor.replaceSelection(`\n${createDefaultHtmlTable()}\n`);
			},
		});

		this.addCommand({
			id: "edit-physics-table-at-cursor",
			name: "Edit Physics Table at Cursor",
			editorCallback: (editor, view) => {
				const markdown = editor.getValue();
				const cursorLine = editor.getCursor().line;
				const range = findPtTableRangeAroundLine(markdown, cursorLine);

				if (!range) {
					new Notice("Place the cursor inside a <table class=\"pt-table\"> block first.");
					return;
				}

				new HtmlTableEditorModal({
					app: this.app,
					data: parseHtmlTableSource(getRangeSource(markdown, range)),
					sourcePath: view.file?.path ?? "",
					sourceRange: range,
					onSaved: () => undefined,
				}).open();
			},
		});

		this.addRibbonIcon("table", "Insert Physics Table", () => {
			const view = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (!view) {
				return;
			}
			view.editor.replaceSelection(`\n${createDefaultHtmlTable()}\n`);
		});

		this.addRibbonIcon("edit-3", "Edit Physics Table at Cursor", () => {
			const view = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (!view) {
				return;
			}

			const markdown = view.editor.getValue();
			const range = findPtTableRangeAroundLine(markdown, view.editor.getCursor().line);
			if (!range) {
				new Notice("Place the cursor inside a <table class=\"pt-table\"> block first.");
				return;
			}

			new HtmlTableEditorModal({
				app: this.app,
				data: parseHtmlTableSource(getRangeSource(markdown, range)),
				sourcePath: view.file?.path ?? "",
				sourceRange: range,
				onSaved: () => undefined,
			}).open();
		});

		this.registerMarkdownPostProcessor((el, ctx) => {
			this.renderHtmlTableMarkdown(el, ctx);
		});
	}

	private injectPtTableCss(): void {
		let styleEl = document.getElementById(PT_TABLE_STYLE_ID) as HTMLStyleElement | null;
		if (!styleEl) {
			styleEl = document.createElement("style");
			styleEl.id = PT_TABLE_STYLE_ID;
			document.head.appendChild(styleEl);
		}
		styleEl.textContent = PT_TABLE_CSS;
	}

	private renderHtmlTableMarkdown(el: HTMLElement, ctx: MarkdownPostProcessorContext): void {
		const tables = Array.from(el.querySelectorAll<HTMLTableElement>("table.pt-table"));

		for (const tableEl of tables) {
			if (tableEl.dataset.physicsTableEditorProcessed === "true") {
				continue;
			}

			tableEl.dataset.physicsTableEditorProcessed = "true";
			const data = parseHtmlTableElement(tableEl);
			void this.renderMarkdownInTable(tableEl, data, ctx);
		}
	}

	private async renderMarkdownInTable(tableEl: HTMLTableElement, data: ReturnType<typeof parseHtmlTableElement>, ctx: MarkdownPostProcessorContext): Promise<void> {
		const domCells = Array.from(tableEl.querySelectorAll<HTMLTableCellElement>("td, th"));
		let domCellIndex = 0;

		for (const row of data.rows) {
			for (const cell of row) {
				if (cell.covered) {
					continue;
				}

				const domCell = domCells[domCellIndex];
				domCellIndex += 1;
				if (!domCell) {
					continue;
				}

				domCell.empty();
				await MarkdownRenderer.render(this.app, cell.text, domCell, ctx.sourcePath, this);
			}
		}
	}
}
