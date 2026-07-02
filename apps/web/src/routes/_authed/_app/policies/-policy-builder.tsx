import { isCanonicalSelector, isValidActionTokenShape, isValidSelector } from "@better-update/api";
import { Badge } from "@better-update/ui/components/ui/badge";
import { Button } from "@better-update/ui/components/ui/button";
import { Field, FieldError, FieldLabel } from "@better-update/ui/components/ui/field";
import { Input } from "@better-update/ui/components/ui/input";
import {
  Menu,
  MenuCheckboxItem,
  MenuItem,
  MenuPopup,
  MenuTrigger,
} from "@better-update/ui/components/ui/menu";
import {
  Select,
  SelectGroup,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@better-update/ui/components/ui/select";
import { PlusIcon, Trash2Icon, XIcon } from "lucide-react";

import type { PolicyDocumentValue, PolicyEffectValue } from "@better-update/api-client/react";

import { EFFECT_OPTIONS, RESOURCE_VOCABULARY, SELECTOR_PRESETS } from "./-policy-vocabulary";

export interface ResourceDraft {
  readonly id: string;
  readonly value: string;
}

export interface StatementDraft {
  readonly id: string;
  readonly effect: PolicyEffectValue;
  readonly actions: readonly string[];
  readonly resources: readonly ResourceDraft[];
}

const newResourceDraft = (value: string): ResourceDraft => ({ id: crypto.randomUUID(), value });

export const newStatementDraft = (): StatementDraft => ({
  id: crypto.randomUUID(),
  effect: "allow",
  actions: [],
  resources: [newResourceDraft("*")],
});

const ActionChip = ({ token, onRemove }: { token: string; onRemove: () => void }) => (
  <Badge variant="secondary" className="gap-1 font-mono text-xs">
    {token}
    <button
      type="button"
      aria-label={`Remove ${token}`}
      className="hover:text-foreground -mr-0.5 inline-flex"
      onClick={onRemove}
    >
      <XIcon className="size-3" strokeWidth={2.5} />
    </button>
  </Badge>
);

const ActionPicker = ({
  selected,
  onToggle,
}: {
  selected: readonly string[];
  onToggle: (token: string) => void;
}) => (
  <Menu>
    <MenuTrigger
      render={
        <Button variant="outline" size="sm">
          <PlusIcon className="size-3.5" strokeWidth={2} data-icon="inline-start" />
          Add action
        </Button>
      }
    />
    <MenuPopup align="start" className="max-h-80 w-72 overflow-y-auto">
      <MenuCheckboxItem
        checked={selected.includes("*")}
        onCheckedChange={() => {
          onToggle("*");
        }}
      >
        <span className="font-mono text-xs">* (all actions)</span>
      </MenuCheckboxItem>
      {RESOURCE_VOCABULARY.map((entry) => (
        <MenuCheckboxItem
          key={`${entry.resource}:*`}
          checked={selected.includes(`${entry.resource}:*`)}
          onCheckedChange={() => {
            onToggle(`${entry.resource}:*`);
          }}
        >
          <span className="font-mono text-xs">{entry.resource}:*</span>
        </MenuCheckboxItem>
      ))}
      {RESOURCE_VOCABULARY.flatMap((entry) =>
        entry.actions.map((action) => {
          const token = `${entry.resource}:${action}`;
          return (
            <MenuCheckboxItem
              key={token}
              checked={selected.includes(token)}
              onCheckedChange={() => {
                onToggle(token);
              }}
            >
              <span className="font-mono text-xs">{token}</span>
            </MenuCheckboxItem>
          );
        }),
      )}
    </MenuPopup>
  </Menu>
);

const ResourceRow = ({
  value,
  onChange,
  onRemove,
  canRemove,
}: {
  value: string;
  onChange: (next: string) => void;
  onRemove: () => void;
  canRemove: boolean;
}) => {
  const invalid = value.length > 0 && (!isValidSelector(value) || !isCanonicalSelector(value));
  return (
    <div className="flex items-start gap-2">
      <Field invalid={invalid} className="flex-1 gap-1">
        <Input
          aria-label="Resource selector"
          placeholder="* or project/{projectId} or appleTeam/{appleTeamId}"
          className="font-mono text-xs"
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        />
        <FieldError match={invalid}>Not a valid resource path selector.</FieldError>
      </Field>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Remove resource selector"
        disabled={!canRemove}
        onClick={onRemove}
      >
        <XIcon className="size-4" strokeWidth={2} />
      </Button>
    </div>
  );
};

const SelectorPresetMenu = ({ onInsert }: { onInsert: (value: string) => void }) => (
  <Menu>
    <MenuTrigger
      render={
        <Button variant="outline" size="sm">
          <PlusIcon className="size-3.5" strokeWidth={2} data-icon="inline-start" />
          Add selector
        </Button>
      }
    />
    <MenuPopup align="start" className="w-80">
      {SELECTOR_PRESETS.map((preset) => (
        <MenuItem
          key={preset.value}
          className="flex-col items-start gap-0.5"
          onClick={() => {
            onInsert(preset.value);
          }}
        >
          <span>{preset.label}</span>
          <span className="text-muted-foreground font-mono text-xs break-all">{preset.value}</span>
        </MenuItem>
      ))}
    </MenuPopup>
  </Menu>
);

const StatementCard = ({
  statement,
  index,
  canRemove,
  onChange,
  onRemove,
}: {
  statement: StatementDraft;
  index: number;
  canRemove: boolean;
  onChange: (next: StatementDraft) => void;
  onRemove: () => void;
}) => {
  const toggleAction = (token: string): void => {
    const next = statement.actions.includes(token)
      ? statement.actions.filter((existing) => existing !== token)
      : [...statement.actions, token];
    onChange({ ...statement, actions: next });
  };

  const setResource = (resourceId: string, value: string): void => {
    onChange({
      ...statement,
      resources: statement.resources.map((existing) =>
        existing.id === resourceId ? { ...existing, value } : existing,
      ),
    });
  };

  const removeResource = (resourceId: string): void => {
    onChange({
      ...statement,
      resources: statement.resources.filter((existing) => existing.id !== resourceId),
    });
  };

  const insertResource = (value: string): void => {
    onChange({ ...statement, resources: [...statement.resources, newResourceDraft(value)] });
  };

  return (
    <div className="border-border bg-muted/30 flex flex-col gap-4 rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Statement {index + 1}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Remove statement"
          disabled={!canRemove}
          onClick={onRemove}
        >
          <Trash2Icon className="size-4" strokeWidth={2} />
        </Button>
      </div>

      <Field className="gap-1.5">
        <FieldLabel>Effect</FieldLabel>
        <Select
          value={statement.effect}
          onValueChange={(next) => {
            if (next === null) {
              return;
            }
            onChange({ ...statement, effect: next });
          }}
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Effect" />
          </SelectTrigger>
          <SelectPopup>
            <SelectGroup>
              {EFFECT_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectPopup>
        </Select>
      </Field>

      <Field className="gap-1.5">
        <FieldLabel>Actions</FieldLabel>
        <div className="flex flex-wrap items-center gap-1.5">
          {statement.actions.length === 0 ? (
            <span className="text-muted-foreground text-xs">No actions selected yet.</span>
          ) : (
            statement.actions.map((token) => (
              <ActionChip
                key={token}
                token={token}
                onRemove={() => {
                  toggleAction(token);
                }}
              />
            ))
          )}
        </div>
        <div>
          <ActionPicker selected={statement.actions} onToggle={toggleAction} />
        </div>
      </Field>

      <Field className="gap-1.5">
        <FieldLabel>Resources</FieldLabel>
        <div className="flex w-full flex-col gap-2">
          {statement.resources.map((resource) => (
            <ResourceRow
              key={resource.id}
              value={resource.value}
              canRemove={statement.resources.length > 1}
              onChange={(next) => {
                setResource(resource.id, next);
              }}
              onRemove={() => {
                removeResource(resource.id);
              }}
            />
          ))}
        </div>
        <div>
          <SelectorPresetMenu onInsert={insertResource} />
        </div>
      </Field>
    </div>
  );
};

export const draftsToDocument = (statements: readonly StatementDraft[]): PolicyDocumentValue => ({
  statements: statements.map((statement) => ({
    effect: statement.effect,
    actions: [...statement.actions],
    resources: statement.resources.map((resource) => resource.value.trim()),
  })),
});

export const documentToDrafts = (document: PolicyDocumentValue): StatementDraft[] =>
  document.statements.map((statement) => ({
    id: crypto.randomUUID(),
    effect: statement.effect,
    actions: [...statement.actions],
    resources:
      statement.resources.length > 0
        ? statement.resources.map((value) => newResourceDraft(value))
        : [newResourceDraft("*")],
  }));

export const isStatementValid = (statement: StatementDraft): boolean => {
  const actionsOk =
    statement.actions.length > 0 && statement.actions.every(isValidActionTokenShape);
  const resourcesOk =
    statement.resources.length > 0 &&
    statement.resources.every(
      (resource) =>
        resource.value.length > 0 &&
        isValidSelector(resource.value) &&
        isCanonicalSelector(resource.value),
    );
  return actionsOk && resourcesOk;
};

export const PolicyBuilder = ({
  statements,
  onChange,
}: {
  statements: readonly StatementDraft[];
  onChange: (next: readonly StatementDraft[]) => void;
}) => {
  const updateStatement = (statementIndex: number, next: StatementDraft): void => {
    onChange(
      statements.map((existing, position) => (position === statementIndex ? next : existing)),
    );
  };

  const removeStatement = (statementIndex: number): void => {
    onChange(statements.filter((_, position) => position !== statementIndex));
  };

  return (
    <div className="flex w-full flex-col gap-4">
      {statements.map((statement, statementIndex) => (
        <StatementCard
          key={statement.id}
          statement={statement}
          index={statementIndex}
          canRemove={statements.length > 1}
          onChange={(next) => {
            updateStatement(statementIndex, next);
          }}
          onRemove={() => {
            removeStatement(statementIndex);
          }}
        />
      ))}
      <Button
        type="button"
        variant="outline"
        className="self-start"
        onClick={() => {
          onChange([...statements, newStatementDraft()]);
        }}
      >
        <PlusIcon className="size-4" strokeWidth={2} data-icon="inline-start" />
        Add statement
      </Button>
    </div>
  );
};
