/** ASG columns are one-based Unicode scalar counts; ends are inclusive. */
export interface AcdcPosition {
  line: number;
  col: number;
  file?: unknown;
}
export type AcdcLocation = [AcdcPosition, AcdcPosition];

/** Consumed ASG fields. Unknown node names are rejected by the adapter. */
export interface AcdcNode {
  name: string;
  type: string;
  location: AcdcLocation;
  value?: string;
  target?: { type: string; value: string };
  source?: { type: string; value: string };
  variant?: string;
  title?: AcdcNode[];
  level?: number;
  items?: AcdcNode[];
  principal?: AcdcNode[];
  marker?: string;
  checked?: boolean;
  content?: AcdcTable;
  metadata?: {
    style?: string;
    attributes?: Record<string, unknown>;
    title?: AcdcNode[];
  };
  inlines?: AcdcNode[];
  blocks?: AcdcNode[];
}
export interface AcdcDocument extends AcdcNode {
  name: "document";
  header?: { title: AcdcNode[]; location: AcdcLocation; authors?: unknown[] };
  attributes?: Record<string, unknown>;
}

export interface AcdcTableRow {
  columns: { content: AcdcNode[]; colspan?: number; rowspan?: number }[];
}
export interface AcdcTable {
  header?: AcdcTableRow | null;
  rows: AcdcTableRow[];
  footer?: AcdcTableRow | null;
}
