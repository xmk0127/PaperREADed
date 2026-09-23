import { Fragment } from "react";
import { InlineMath } from "react-katex";

export type MathTextToken = {
  kind: "text" | "math";
  value: string;
};

export function tokenizeMathText(input: string): MathTextToken[] {
  const tokens: MathTextToken[] = [];
  let cursor = 0;

  while (cursor < input.length) {
    const start = input.indexOf("\\(", cursor);
    if (start === -1) {
      tokens.push({ kind: "text", value: input.slice(cursor) });
      break;
    }

    const end = input.indexOf("\\)", start + 2);
    if (end === -1) {
      tokens.push({ kind: "text", value: input.slice(cursor) });
      break;
    }

    if (start > cursor) {
      tokens.push({ kind: "text", value: input.slice(cursor, start) });
    }
    tokens.push({ kind: "math", value: input.slice(start + 2, end) });
    cursor = end + 2;
  }

  return tokens.filter((token) => token.value.length > 0);
}

export function MathText({ children }: { children: string }) {
  return (
    <span className="math-text">
      {tokenizeMathText(children).map((token, index) => (
        <Fragment key={`${token.kind}-${index}`}>
          {token.kind === "math" ? (
            <InlineMath
              math={token.value}
              renderError={() => <code className="math-text__fallback">{token.value}</code>}
            />
          ) : (
            token.value
          )}
        </Fragment>
      ))}
    </span>
  );
}
