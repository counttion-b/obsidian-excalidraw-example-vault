export type HorizontalAlign = "left" | "center" | "right";
export type VerticalAlign = "top" | "middle" | "bottom";

export interface HtmlTableCell {
	text: string;
	align?: HorizontalAlign;
	valign?: VerticalAlign;
	bold?: boolean;
	colspan: number;
	rowspan: number;
	covered?: boolean;
}

export interface HtmlTableData {
	tableWidth: string;
	colWidths: string[];
	rows: HtmlTableCell[][];
}

export interface CellCoord {
	row: number;
	col: number;
}
