import { DOMParser } from "@xmldom/xmldom";

export type PlistValue = string | number | boolean | Date | PlistObject | readonly PlistValue[];

export interface PlistObject {
  readonly [key: string]: PlistValue;
}

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const CDATA_NODE = 4;

const isNode = (node: Node | null): node is Node => node !== null;

const nodeListItems = (nodes: NodeList): readonly Node[] =>
  Array.from({ length: nodes.length }, (_, index) => nodes.item(index)).filter(isNode);

const isElementNode = (node: Node): node is Element => node.nodeType === ELEMENT_NODE;

const isDocumentLike = (value: unknown): value is { readonly documentElement?: Element | null } =>
  typeof value === "object" && value !== null && "documentElement" in value;

const childElements = (node: Node): readonly Element[] =>
  nodeListItems(node.childNodes).filter(isElementNode);

const textValue = (node: Node): string =>
  nodeListItems(node.childNodes)
    .filter((child) => child.nodeType === TEXT_NODE || child.nodeType === CDATA_NODE)
    .map((child) => (typeof child.nodeValue === "string" ? child.nodeValue : ""))
    .join("");

const parsePlistElement = (element: Element): PlistValue | null => {
  switch (element.nodeName) {
    case "plist": {
      const children = childElements(element);
      const [child] = children;
      return children.length === 1 && child !== undefined ? parsePlistElement(child) : null;
    }
    case "dict": {
      const children = childElements(element);
      if (children.length % 2 !== 0) {
        return null;
      }
      const entries = Array.from({ length: children.length / 2 }, (_, entryIndex) => {
        const keyNode = children[entryIndex * 2];
        const valueNode = children[entryIndex * 2 + 1];
        if (keyNode?.nodeName !== "key" || valueNode === undefined) {
          return null;
        }
        const value = parsePlistElement(valueNode);
        return value === null ? null : ([textValue(keyNode), value] as const);
      });
      return entries.every((entry): entry is readonly [string, PlistValue] => entry !== null)
        ? Object.fromEntries(entries)
        : null;
    }
    case "array": {
      const values = childElements(element).map(parsePlistElement);
      return values.every((value): value is PlistValue => value !== null) ? values : null;
    }
    case "key":
    case "string": {
      return textValue(element);
    }
    case "data": {
      return textValue(element).replaceAll(/\s+/gu, "");
    }
    case "date": {
      return new Date(textValue(element));
    }
    case "integer": {
      return Number.parseInt(textValue(element), 10);
    }
    case "real": {
      return Number.parseFloat(textValue(element));
    }
    case "true": {
      return true;
    }
    case "false": {
      return false;
    }
    default: {
      return null;
    }
  }
};

export const isPlistObject = (value: unknown): value is PlistObject =>
  typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date);

const parseXmlDocument = (xml: string): unknown => {
  // eslint-disable-next-line functional/no-try-statements -- xmldom throws ParseError for malformed XML; plist parsing should return null for invalid input
  try {
    return new DOMParser({ errorHandler: () => undefined }).parseFromString(xml, "text/xml");
  } catch {
    return null;
  }
};

export const parsePlistXml = (xml: string): PlistObject | null => {
  const parsedDocument = parseXmlDocument(xml);
  const root = isDocumentLike(parsedDocument) ? parsedDocument.documentElement : null;
  if (root?.nodeName !== "plist") {
    return null;
  }
  const parsed = parsePlistElement(root);
  return isPlistObject(parsed) ? parsed : null;
};

export const getPlistString = (obj: PlistObject, key: string): string | null => {
  const value = obj[key];
  return typeof value === "string" ? value : null;
};

export const getPlistBoolean = (obj: PlistObject, key: string): boolean => obj[key] === true;

export const getPlistDateString = (obj: PlistObject, key: string): string | null => {
  const value = obj[key];
  if (value instanceof Date) {
    return value.toISOString();
  }
  return typeof value === "string" ? value : null;
};

export const getPlistObject = (obj: PlistObject, key: string): PlistObject | null => {
  const value = obj[key];
  return isPlistObject(value) ? value : null;
};

export const getPlistStringArray = (obj: PlistObject, key: string): readonly string[] => {
  const value = obj[key];
  return Array.isArray(value)
    ? value.flatMap((item) => (typeof item === "string" && item.length > 0 ? [item] : []))
    : [];
};
