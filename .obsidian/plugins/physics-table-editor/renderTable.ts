import { MarkdownPostProcessorContext } from "obsidian";
import { HtmlTableCell, HtmlTableData } from "./tableTypes";

const DEFAULT_COL_WIDTH = "160px";

export function createDefaultHtmlTable(): string {
	return formatHtmlTable({
		tableWidth: "100%",
		colWidths: ["160px", "160px", "160px"],
		rows: [
			[createCell(""), createCell(""), createCell("")],
			[createCell(""), createCell(""), createCell("")],
			[createCell(""), createCell(""), createCell("")],
		],
	});
}

export function parseHtmlTableElement(tableEl: HTMLTableElement): HtmlTableData {
	const tableWidth = tableEl.style.width || tableEl.getAttribute("width") || "100%";
	const colWidths = readColWidths(tableEl);
	const rows: HtmlTableCell[][] = [];

	Array.from(tableEl.rows).forEach((tr, rowIndex) => {
		rows[rowIndex] ??= [];
		let colIndex = 0;

		Array.from(tr.cells).forEach((cellEl) => {
			while (rows[rowIndex][colIndex]?.covered) {
				colIndex += 1;
			}

			const colspan = Math.max(cellEl.colSpan || 1, 1);
			const rowspan = Math.max(cellEl.rowSpan || 1, 1);
			rows[rowIndex][colIndex] = {
				text: normalizeCellText(cellEl),
				align: readAlign(cellEl),
				valign: readValign(cellEl),
				bold: readBold(cellEl),
				colspan,
				rowspan,
			};

			for (let rowOffset = 0; rowOffset < rowspan; rowOffset += 1) {
				const targetRow = rowIndex + rowOffset;
				rows[targetRow] ??= [];

				for (let colOffset = 0; colOffset < colspan; colOffset += 1) {
					if (rowOffset === 0 && colOffset === 0) {
						continue;
					}

					rows[targetRow][colIndex + colOffset] = createCoveredCell();
				}
			}

			colIndex += colspan;
		});
	});

	const cols = Math.max(colWidths.length, ...rows.map((row) => row.length), 1);
	const normalizedRows = rows.length > 0 ? rows : [[createCell("")]];

	for (const row of normalizedRows) {
		for (let col = 0; col < cols; col += 1) {
			row[col] ??= createCell("");
		}
	}

	return {
		tableWidth,
		colWidths: Array.from({ length: cols }, (_, index) => normalizeCssSize(colWidths[index] ?? DEFAULT_COL_WIDTH)),
		rows: normalizedRows,
	};
}

export function parseHtmlTableSource(source: string): HtmlTableData {
	const doc = new DOMParser().parseFromString(source, "text/html");
	const table = doc.querySelector<HTMLTableElement>("table.pt-table");
	if (!table) {
		throw new Error("No table.pt-table found in source.");
	}

	return parseHtmlTableElement(table);
}

export function formatHtmlTable(data: HtmlTableData): string {
	const rows = normalizeTableMatrix(data.rows);
	const colCount = Math.max(data.colWidths.length, ...rows.map((row) => row.length), 1);
	const colWidths = normalizeColWidthsForOutput(
		Array.from({ length: colCount }, (_, index) => normalizeCssSize(data.colWidths[index] ?? DEFAULT_COL_WIDTH))
	);
	const tableWidth = normalizeCssSize(data.tableWidth || "100%");

	const lines: string[] = [];
	lines.push(`<table class="pt-table" style="width: ${escapeAttribute(tableWidth)};">`);
	lines.push("  <colgroup>");
	for (const width of colWidths) {
		lines.push(`    <col style="width: ${escapeAttribute(width)};">`);
	}
	lines.push("  </colgroup>");
	lines.push("  <tbody>");

	for (const row of rows) {
		lines.push("    <tr>");
		for (const cell of row) {
			if (cell.covered) {
				continue;
			}

			const attrs = formatCellAttributes(cell);
			const content = escapeHtml(cell.text);
			lines.push(`      <td${attrs}>${content}</td>`);
		}
		lines.push("    </tr>");
	}

	lines.push("  </tbody>");
	lines.push("</table>");
	return lines.join("\n");
}

export function replaceCurrentHtmlTable(markdown: string, ctx: MarkdownPostProcessorContext, tableEl: HTMLElement, nextHtml: string): string {
	const section = ctx.getSectionInfo(tableEl);
	const lines = markdown.split(/\r?\n/);
	const newline = markdown.includes("\r\n") ? "\r\n" : "\n";
	const sectionStart = section?.lineStart ?? 0;
	const sectionEnd = section?.lineEnd ?? lines.length - 1;
	const range = findTableRange(lines, sectionStart, sectionEnd);

	if (!range) {
		throw new Error("Cannot locate the current pt-table in the Markdown source.");
	}

	lines.splice(range.start, range.end - range.start + 1, ...nextHtml.split("\n"));
	return lines.join(newline);
}

export function replaceHtmlTableRange(markdown: string, range: { start: number; end: number }, nextHtml: string): string {
	const lines = markdown.split(/\r?\n/);
	const newline = markdown.includes("\r\n") ? "\r\n" : "\n";
	lines.splice(range.start, range.end - range.start + 1, ...nextHtml.split("\n"));
	return lines.join(newline);
}

export function findPtTableRangeAroundLine(markdown: string, cursorLine: number): { start: number; end: number } | null {
	const lines = markdown.split(/\r?\n/);
	let start = -1;

	for (let line = Math.min(cursorLine, lines.length - 1); line >= 0; line -= 1) {
		if (/<table\b[^>]*class=["'][^"']*\bpt-table\b[^"']*["'][^>]*>/i.test(lines[line])) {
			start = line;
			break;
		}
		if (/<\/table>/i.test(lines[line])) {
			break;
		}
	}

	if (start === -1) {
		for (let line = cursorLine + 1; line < lines.length; line += 1) {
			if (/<table\b[^>]*class=["'][^"']*\bpt-table\b[^"']*["'][^>]*>/i.test(lines[line])) {
				start = line;
				break;
			}
			if (line - cursorLine > 5) {
				break;
			}
		}
	}

	if (start === -1) {
		return null;
	}

	for (let end = start; end < lines.length; end += 1) {
		if (/<\/table>/i.test(lines[end])) {
			return { start, end };
		}
	}

	return null;
}

export function getRangeSource(markdown: string, range: { start: number; end: number }): string {
	return markdown.split(/\r?\n/).slice(range.start, range.end + 1).join("\n");
}

export function createCell(text: string): HtmlTableCell {
	return {
		text,
		colspan: 1,
		rowspan: 1,
	};
}

export function createCoveredCell(): HtmlTableCell {
	return {
		text: "",
		colspan: 1,
		rowspan: 1,
		covered: true,
	};
}

export function normalizeCssSize(value: string): string {
	const trimmed = value.trim();
	if (trimmed === "") {
		return "";
	}

	if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
		return `${trimmed}px`;
	}

	return trimmed;
}

function readColWidths(tableEl: HTMLTableElement): string[] {
	const cols = tableEl.querySelectorAll<HTMLTableColElement>(":scope > colgroup > col");
	return Array.from(cols).map((col) => col.style.width || col.getAttribute("width") || DEFAULT_COL_WIDTH);
}

function normalizeCellText(cellEl: HTMLTableCellElement): string {
	return cellEl.textContent ?? "";
}

function readAlign(cellEl: HTMLTableCellElement): HtmlTableCell["align"] {
	if (cellEl.classList.contains("pt-left")) {
		return "left";
	}
	if (cellEl.classList.contains("pt-center")) {
		return "center";
	}
	if (cellEl.classList.contains("pt-right")) {
		return "right";
	}

	const value = cellEl.style.textAlign;
	if (value === "left" || value === "center" || value === "right") {
		return value;
	}
	return undefined;
}

function readValign(cellEl: HTMLTableCellElement): HtmlTableCell["valign"] {
	if (cellEl.classList.contains("pt-vtop")) {
		return "top";
	}
	if (cellEl.classList.contains("pt-vmiddle")) {
		return "middle";
	}
	if (cellEl.classList.contains("pt-vbottom")) {
		return "bottom";
	}

	const value = cellEl.style.verticalAlign;
	if (value === "top" || value === "middle" || value === "bottom") {
		return value;
	}
	return undefined;
}

function readBold(cellEl: HTMLTableCellElement): boolean | undefined {
	if (cellEl.classList.contains("pt-bold")) {
		return true;
	}

	const fontWeight = cellEl.style.fontWeight;
	if (fontWeight === "bold" || Number(fontWeight) >= 600) {
		return true;
	}

	return undefined;
}

function normalizeTableMatrix(rows: HtmlTableCell[][]): HtmlTableCell[][] {
	const rowCount = Math.max(rows.length, 1);
	const colCount = Math.max(...rows.map((row) => row.length), 1);

	return Array.from({ length: rowCount }, (_, rowIndex) => {
		const sourceRow = rows[rowIndex] ?? [];
		return Array.from({ length: colCount }, (_, colIndex) => sourceRow[colIndex] ?? createCell(""));
	});
}

function normalizeColWidthsForOutput(widths: string[]): string[] {
	const numericWidths = widths.map((width) => cssSizeToNumber(width));
	if (numericWidths.some((width) => width <= 0)) {
		return widths;
	}

	const total = numericWidths.reduce((sum, width) => sum + width, 0);
	if (total <= 0) {
		return widths;
	}

	return numericWidths.map((width) => `${roundPercentage(width / total * 100)}%`);
}

function cssSizeToNumber(value: string): number {
	const match = value.trim().match(/^(\d+(?:\.\d+)?)(px)?$/i);
	if (!match) {
		return 0;
	}

	return Number(match[1]);
}

function roundPercentage(value: number): string {
	return Number(value.toFixed(4)).toString();
}

function formatCellAttributes(cell: HtmlTableCell): string {
	const attrs: string[] = [];
	const classes: string[] = [];

	if (cell.colspan > 1) {
		attrs.push(`colspan="${cell.colspan}"`);
	}
	if (cell.rowspan > 1) {
		attrs.push(`rowspan="${cell.rowspan}"`);
	}
	if (cell.align) {
		classes.push(`pt-${cell.align}`);
	}
	if (cell.valign) {
		classes.push(`pt-v${cell.valign}`);
	}
	if (cell.bold) {
		classes.push("pt-bold");
	}
	if (classes.length > 0) {
		attrs.push(`class="${escapeAttribute(classes.join(" "))}"`);
	}

	return attrs.length > 0 ? ` ${attrs.join(" ")}` : "";
}

function findTableRange(lines: string[], lineStart: number, lineEnd: number): { start: number; end: number } | null {
	const startLimit = Math.max(0, lineStart - 5);
	const endLimit = Math.min(lines.length - 1, lineEnd + 20);

	for (let line = startLimit; line <= endLimit; line += 1) {
		if (/<table\b[^>]*class=["'][^"']*\bpt-table\b[^"']*["'][^>]*>/i.test(lines[line])) {
			for (let endLine = line; endLine <= lines.length - 1; endLine += 1) {
				if (/<\/table>/i.test(lines[endLine])) {
					return { start: line, end: endLine };
				}
			}
		}
	}

	return null;
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

function escapeAttribute(value: string): string {
	return escapeHtml(value).replace(/"/g, "&quot;");
}
