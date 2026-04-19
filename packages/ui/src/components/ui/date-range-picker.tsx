import { format } from "date-fns"
import { CalendarIcon } from "lucide-react"

import { cn } from "#/lib/utils"
import { Calendar } from "#/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "#/components/ui/popover"

import type { DateRange } from "react-day-picker"

export interface DateRangePickerProps {
  value: DateRange | undefined
  onChange: (value: DateRange | undefined) => void
  placeholder?: string
  numberOfMonths?: number
  className?: string
  triggerClassName?: string
}

const formatLabel = (range: DateRange | undefined, placeholder: string) => {
  if (!range?.from) {
    return placeholder
  }
  if (!range.to) {
    return format(range.from, "MMM d, yyyy")
  }
  return `${format(range.from, "MMM d, yyyy")} – ${format(range.to, "MMM d, yyyy")}`
}

export function DateRangePicker({
  value,
  onChange,
  placeholder = "Date range",
  numberOfMonths = 2,
  className,
  triggerClassName,
}: DateRangePickerProps) {
  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          "border-border bg-background hover:bg-muted aria-expanded:bg-muted inline-flex h-9 w-64 items-center gap-1.5 rounded-md border px-2.5 text-sm font-normal shadow-xs outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
          triggerClassName
        )}
      >
        <CalendarIcon className="size-4" />
        <span className={value?.from ? undefined : "text-muted-foreground"}>
          {formatLabel(value, placeholder)}
        </span>
      </PopoverTrigger>
      <PopoverContent align="start" className={cn("w-auto p-0", className)}>
        <Calendar
          mode="range"
          selected={value}
          onSelect={onChange}
          numberOfMonths={numberOfMonths}
        />
      </PopoverContent>
    </Popover>
  )
}
