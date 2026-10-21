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
  variant?: string;
  inlines?: AcdcNode[];
  blocks?: AcdcNode[];
}
export interface AcdcDocument extends AcdcNode {
  name: "document";
  header?: unknown;
  attributes?: Record<string, unknown>;
}
