"use client"

import { format } from "date-fns"
import { CalendarIcon } from "lucide-react"
import { useEffect, useId, useState } from "react"

import type { DateRange } from "react-day-picker"
import type { ReactNode } from "react"

import { Button } from "#/components/ui/button"
import { Calendar } from "#/components/ui/calendar"
import { Input } from "#/components/ui/input"
import { Label } from "#/components/ui/label"
import {
  Popover,
  PopoverPopup,
  PopoverTrigger,
} from "#/components/ui/popover"
import { cn } from "#/lib/utils"

export interface DateRangePickerProps {
  value: DateRange | undefined
  onChange: (value: DateRange | undefined) => void
  placeholder?: string
  numberOfMonths?: number
  className?: string
  triggerClassName?: string
}

const formatTime = (date: Date | undefined, fallback: string) =>
  date ? format(date, "HH:mm") : fallback

const renderLabel = (
  range: DateRange | undefined,
  placeholder: string,
): ReactNode => {
  if (!range?.from) {
    return <span className="text-muted-foreground">{placeholder}</span>
  }
  if (!range.to || range.from.getTime() === range.to.getTime()) {
    return format(range.from, "LLL dd, y HH:mm")
  }
  const sameYear = range.from.getFullYear() === range.to.getFullYear()
  if (sameYear) {
    return `${format(range.from, "LLL dd HH:mm")} – ${format(range.to, "LLL dd HH:mm, y")}`
  }
  return `${format(range.from, "LLL dd, y HH:mm")} – ${format(range.to, "LLL dd, y HH:mm")}`
}

const applyTimeToDate = (date: Date, time: string, isEnd: boolean) => {
  const [hStr, mStr] = time.split(":")
  const next = new Date(date)
  next.setHours(
    Number(hStr) || 0,
    Number(mStr) || 0,
    isEnd ? 59 : 0,
    isEnd ? 999 : 0,
  )
  return next
}

export function DateRangePicker({
  value,
  onChange,
  placeholder = "Pick a date range",
  numberOfMonths = 2,
  className,
  triggerClassName,
}: DateRangePickerProps) {
  const fromTimeId = useId()
  const toTimeId = useId()
  const [open, setOpen] = useState(false)
  const [pendingRange, setPendingRange] = useState<DateRange | undefined>(value)
  const [fromTime, setFromTime] = useState(formatTime(value?.from, "00:00"))
  const [toTime, setToTime] = useState(formatTime(value?.to, "23:59"))

  useEffect(() => {
    if (open) {
      setPendingRange(value)
      setFromTime(formatTime(value?.from, "00:00"))
      setToTime(formatTime(value?.to, "23:59"))
    }
  }, [open, value])

  const handleApply = () => {
    if (!pendingRange?.from) {
      onChange(undefined)
    } else {
      const from = applyTimeToDate(pendingRange.from, fromTime, false)
      const toBase = pendingRange.to ?? pendingRange.from
      const to = applyTimeToDate(toBase, toTime, true)
      onChange({ from, to })
    }
    setOpen(false)
  }

  const handleReset = () => {
    onChange(undefined)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            className={cn("justify-start", triggerClassName)}
            variant="outline"
          />
        }
      >
        <CalendarIcon aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-left">
          {renderLabel(value, placeholder)}
        </span>
      </PopoverTrigger>
      <PopoverPopup align="start" className={cn("w-auto p-0", className)}>
        <Calendar
          mode="range"
          numberOfMonths={numberOfMonths}
          onSelect={setPendingRange}
          selected={pendingRange}
          {...(pendingRange?.from ? { defaultMonth: pendingRange.from } : {})}
        />
        <div className="flex flex-col gap-3 border-t p-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={fromTimeId} className="text-muted-foreground text-xs">
                From time
              </Label>
              <Input
                id={fromTimeId}
                type="time"
                value={fromTime}
                onChange={(event) => {
                  setFromTime(event.target.value)
                }}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={toTimeId} className="text-muted-foreground text-xs">
                To time
              </Label>
              <Input
                id={toTimeId}
                type="time"
                value={toTime}
                onChange={(event) => {
                  setToTime(event.target.value)
                }}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={handleReset}>
              Reset
            </Button>
            <Button size="sm" onClick={handleApply}>
              Apply
            </Button>
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  )
}
