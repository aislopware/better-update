import { CalendarIcon } from "@phosphor-icons/react";
import { format } from "date-fns";
import { useState } from "react";

import type { ReactNode } from "react";
import type { DateRange } from "react-day-picker";

import { Badge } from "#/components/badge";
import { Button } from "#/components/button";
import { DatePicker } from "#/components/date-picker";
import { Input } from "#/components/input";
import { Popover } from "#/components/popover";
import { Separator } from "#/components/separator";
import { cn } from "#/lib/utils";

export interface DateRangePickerProps {
  readonly value: DateRange | undefined;
  readonly onChange: (value: DateRange | undefined) => void;
  readonly placeholder?: string;
  readonly numberOfMonths?: number;
  readonly className?: string;
  readonly triggerClassName?: string;
  /**
   * "outline" = form-field trigger showing the value inline;
   * "filter" = dashed toolbar chip (faceted-filter style) showing it as a badge.
   */
  readonly triggerVariant?: "outline" | "filter";
}

const formatTime = (date: Date | undefined, fallback: string): string =>
  date ? format(date, "HH:mm") : fallback;

const renderLabel = (range: DateRange | undefined, placeholder: string): ReactNode => {
  if (!range?.from) {
    return <span className="text-kumo-subtle">{placeholder}</span>;
  }
  if (!range.to || range.from.getTime() === range.to.getTime()) {
    return format(range.from, "LLL dd, y HH:mm");
  }
  const sameYear = range.from.getFullYear() === range.to.getFullYear();
  if (sameYear) {
    return `${format(range.from, "LLL dd HH:mm")} – ${format(range.to, "LLL dd HH:mm, y")}`;
  }
  return `${format(range.from, "LLL dd, y HH:mm")} – ${format(range.to, "LLL dd, y HH:mm")}`;
};

const FilterTriggerContent = ({
  value,
  placeholder,
}: {
  value: DateRange | undefined;
  placeholder: string;
}) => (
  <>
    <CalendarIcon aria-hidden="true" />
    {placeholder}
    {value?.from ? (
      <>
        <Separator
          orientation="vertical"
          className="mx-0.5 my-auto data-[orientation=vertical]:h-4"
        />
        <Badge variant="secondary" className="rounded-sm px-1.5 font-normal">
          {renderLabel(value, placeholder)}
        </Badge>
      </>
    ) : null}
  </>
);

const applyTimeToDate = (date: Date, time: string, isEnd: boolean): Date => {
  const [hourPart, minutePart] = time.split(":");
  const hours = Number(hourPart);
  const minutes = Number(minutePart);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) {
    return date;
  }
  const next = new Date(date);
  next.setHours(hours, minutes, isEnd ? 59 : 0, isEnd ? 999 : 0);
  return next;
};

/**
 * The popover body. Split out so that its draft state — the range being picked
 * and the two time bounds — is seeded on mount and thrown away on close: the
 * popover only mounts its content while open, so reopening always starts from
 * the range actually in force rather than from an abandoned edit.
 */
const DateRangePanel = ({
  value,
  numberOfMonths,
  onApply,
  onReset,
}: {
  value: DateRange | undefined;
  numberOfMonths: number;
  onApply: (next: DateRange | undefined) => void;
  onReset: () => void;
}) => {
  const [pendingRange, setPendingRange] = useState<DateRange | undefined>(value);
  const [fromTime, setFromTime] = useState(formatTime(value?.from, "00:00"));
  const [toTime, setToTime] = useState(formatTime(value?.to, "23:59"));
  // The calendar reads this on its first render only, so recomputing it costs
  // nothing: open onto the month already in force, or this month when nothing
  // is selected.
  const defaultMonth = value?.from ?? new Date();

  const handleApply = (): void => {
    if (pendingRange?.from) {
      const from = applyTimeToDate(pendingRange.from, fromTime, false);
      const to = applyTimeToDate(pendingRange.to ?? pendingRange.from, toTime, true);
      onApply({ from, to });
    } else {
      onApply(undefined);
    }
  };

  return (
    <>
      <DatePicker
        mode="range"
        numberOfMonths={numberOfMonths}
        onChange={setPendingRange}
        selected={pendingRange}
        defaultMonth={defaultMonth}
      />
      <div className="border-kumo-hairline flex flex-col gap-3 border-t p-3">
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="From time"
            size="sm"
            type="time"
            value={fromTime}
            onChange={(event) => {
              setFromTime(event.target.value);
            }}
          />
          <Input
            label="To time"
            size="sm"
            type="time"
            value={toTime}
            onChange={(event) => {
              setToTime(event.target.value);
            }}
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onReset}>
            Reset
          </Button>
          <Button onClick={handleApply}>Apply</Button>
        </div>
      </div>
    </>
  );
};

/**
 * Hand-written, unlike its generated neighbours: Kumo's own `DateRangePicker`
 * keeps the selected range in local state with no way to seed or read it, so a
 * range held in the URL could neither open pre-filled nor be applied. This
 * composes the controlled calendar behind it (`DatePicker mode="range"`) with
 * the trigger, the time-of-day bounds and the apply/reset pair the audit-log
 * filter needs.
 */
export const DateRangePicker = ({
  value,
  onChange,
  placeholder = "Pick a date range",
  numberOfMonths = 2,
  className,
  triggerClassName,
  triggerVariant = "outline",
}: DateRangePickerProps) => {
  const [open, setOpen] = useState(false);

  const handleApply = (next: DateRange | undefined): void => {
    onChange(next);
    setOpen(false);
  };

  const handleReset = (): void => {
    onChange(undefined);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        render={
          <Button
            className={cn(
              triggerVariant === "filter" ? "border-dashed" : "justify-start",
              triggerClassName,
            )}
            variant="secondary"
          />
        }
      >
        {triggerVariant === "filter" ? (
          <FilterTriggerContent value={value} placeholder={placeholder} />
        ) : (
          <>
            <CalendarIcon aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-left">
              {renderLabel(value, placeholder)}
            </span>
          </>
        )}
      </Popover.Trigger>
      <Popover.Content align="start" className={cn("w-auto p-0", className)}>
        <DateRangePanel
          value={value}
          numberOfMonths={numberOfMonths}
          onApply={handleApply}
          onReset={handleReset}
        />
      </Popover.Content>
    </Popover>
  );
};
