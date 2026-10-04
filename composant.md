#Shadcn Attachment
npx shadcn@latest add @reui/c-attachment-1
import {
Attachment,
AttachmentAction,
AttachmentActions,
AttachmentContent,
AttachmentDescription,
AttachmentMedia,
AttachmentTitle,
} from "@/components/ui/attachment"
import { DownloadIcon, FileTextIcon } from 'lucide-react'

// Icon names are hoisted static literals because the shadcn CLI rewrites them
// to whichever icon library the installer picked, and it can only rewrite a
// literal. A computed or spread prop value installs as a blank square.
const ICON_REPORT = (
<FileTextIcon  aria-hidden="true" />
)

const ICON_DOWNLOAD = (
<DownloadIcon  aria-hidden="true" />
)

export function Pattern() {
return (

<div className="mx-auto flex w-full max-w-sm flex-col gap-3">
<p className="text-sm">
Here is the cohort breakdown you asked for. Numbers run through 30
September.
</p>
{/\*
_ The root sizes to its own content, so a chip meant to fill the reply
_ column has to be told to stretch.
_/}
<Attachment className="w-full">
<AttachmentMedia>{ICON_REPORT}</AttachmentMedia>
<AttachmentContent>
<AttachmentTitle>retention-cohorts-q3.pdf</AttachmentTitle>
<AttachmentDescription>
PDF
<span
              aria-hidden="true"
              className="bg-muted-foreground/40 mx-1.5 inline-block size-1 rounded-full align-middle"
            />
1.9 MB
</AttachmentDescription>
</AttachmentContent>
<AttachmentActions>
{/_
_ type="button" is spelled out because a bare <button> inside a form
_ defaults to submit, and this chip is meant to be pasted into one.
\*/}
<AttachmentAction
            type="button"
            size="icon-sm"
            variant="secondary"
            aria-label="Download retention-cohorts-q3.pdf"
          >
{ICON_DOWNLOAD}
</AttachmentAction>
</AttachmentActions>
</Attachment>
</div>
)
}

#Shadcn Alert Dialog

npx shadcn@latest add @reui/c-alert-dialog-11
import { Badge } from "@/components/reui/badge"

import {
AlertDialog,
AlertDialogAction,
AlertDialogCancel,
AlertDialogContent,
AlertDialogDescription,
AlertDialogFooter,
AlertDialogMedia,
AlertDialogTitle,
AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { ShieldAlertIcon } from 'lucide-react'

export function Pattern() {
return (
<AlertDialog>
<AlertDialogTrigger
render={<Button variant="outline">System Update</Button>}
/>
<AlertDialogContent className="gap-0 p-0 sm:max-w-sm">

<div className="mx-auto flex flex-col items-center justify-center gap-2 p-8">
<AlertDialogMedia className="bg-info/10 text-info dark:bg-info/20 size-12 rounded-full">
<ShieldAlertIcon  className="size-6" />
</AlertDialogMedia>
<AlertDialogTitle className="text-center">
System Update Available!
</AlertDialogTitle>
<Badge variant="success-light">Release v28.1.0 (2026-01-12)</Badge>
</div>

        <div className="bg-muted/60 flex flex-col items-center justify-center gap-5 rounded-b-2xl p-6">
          <AlertDialogDescription className="text-muted-foreground text-center">
            A new version of the application is ready. Restarting now will apply
            the latest security patches and features.
          </AlertDialogDescription>
          {/* The footer sits inside this `p-6` section, not directly in the
              content, so its breakout has to cancel THAT padding (`-mx-6
              -mb-6`) to reach the edges. `self-stretch` is required because the
              section is `items-center`, which would otherwise shrink the bar to
              its content width and leave the top border floating short. */}
          <AlertDialogFooter className="-mx-6 -mb-6 gap-4 self-stretch rounded-b-2xl p-6">
            <AlertDialogCancel>Remind Me Later</AlertDialogCancel>
            <AlertDialogAction>Update Now</AlertDialogAction>
          </AlertDialogFooter>
        </div>
      </AlertDialogContent>
    </AlertDialog>

)
}

#Shadcn Badge

npx shadcn@latest add @reui/c-badge-4
import { Badge } from "@/components/reui/badge"

export function Pattern() {
return <Badge variant="success">Badge</Badge>
}

#Shadcn Button
npx shadcn@latest add @reui/c-button-18
import { Button } from "@/components/ui/button"
import { PlusIcon } from 'lucide-react'

export function Pattern() {
return (
<Button variant="outline">
<PlusIcon  aria-hidden="true" />
Add Item
</Button>
)
}

npx shadcn@latest add @reui/c-button-22
import { Button } from "@/components/ui/button"
import { Trash2Icon } from 'lucide-react'

export function Pattern() {
return (
<Button variant="destructive">
<Trash2Icon  aria-hidden="true" />
Delete Account
</Button>
)
}

npx shadcn@latest add @reui/c-button-11
import { Button } from "@/components/ui/button"
import { SearchIcon } from 'lucide-react'

export function Pattern() {
return (
<Button size="icon" aria-label="Search">
<SearchIcon  aria-hidden="true" />
</Button>
)
}

#Shadcn Calendar
npx shadcn@latest add @reui/c-calendar-14

"use client"

import { useState } from "react"
import { format } from "date-fns"

import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Card, CardContent } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"

export function Pattern() {
const today = new Date()
const [date, setDate] = useState<Date>(today)
const [time, setTime] = useState<string | null>(null)

// Mock time slots data
const timeSlots = [
{ available: false, time: "09:00" },
{ available: false, time: "09:30" },
{ available: true, time: "10:00" },
{ available: true, time: "10:30" },
{ available: true, time: "11:00" },
{ available: true, time: "11:30" },
{ available: false, time: "12:00" },
{ available: true, time: "12:30" },
{ available: true, time: "13:00" },
{ available: true, time: "13:30" },
{ available: true, time: "14:00" },
{ available: false, time: "14:30" },
{ available: false, time: "15:00" },
{ available: true, time: "15:30" },
{ available: true, time: "16:00" },
{ available: true, time: "16:30" },
{ available: true, time: "17:00" },
{ available: true, time: "17:30" },
]

return (
<Card className="p-0">
<CardContent className="p-0">

<div className="flex max-sm:flex-col">
<Calendar
disabled={[{ before: today }]}
mode="single"
onSelect={(newDate) => {
if (newDate) {
setDate(newDate)
setTime(null)
}
}}
selected={date}
/>
<div className="relative w-full max-sm:h-48 sm:w-40">
<div className="absolute inset-0 py-4 max-sm:border-t">
<ScrollArea className="h-full sm:border-s">
<div className="space-y-3">
<div className="flex h-5 shrink-0 items-center px-5">
<p className="text-sm font-medium">
{format(date, "EEEE, d")}
</p>
</div>
<div className="grid gap-1.5 px-5 max-sm:grid-cols-2">
{timeSlots.map(({ time: timeSlot, available }) => (
<Button
className="w-full"
disabled={!available}
key={timeSlot}
onClick={() => setTime(timeSlot)}
size="sm"
variant={time === timeSlot ? "default" : "outline"} >
{timeSlot}
</Button>
))}
</div>
</div>
</ScrollArea>
</div>
</div>
</div>
</CardContent>
</Card>
)
}

#Shadcn Card
npx shadcn@latest add @reui/c-card-15
import { Badge } from "@/components/reui/badge"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
DropdownMenu,
DropdownMenuContent,
DropdownMenuGroup,
DropdownMenuItem,
DropdownMenuSeparator,
DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Separator } from "@/components/ui/separator"
import { ArrowDownIcon, ArrowUpIcon, MoreHorizontalIcon, PinIcon, SettingsIcon, Share2Icon, TrashIcon, TriangleAlertIcon } from 'lucide-react'

export function Pattern() {
const title = "Revenue"
const value = "$12.4k"
const delta = 12.5
const positive = true
const lastMonth = "$11.0k"

return (
<Card className="w-full max-w-xs">
<CardContent className="flex flex-col gap-5">
<div className="flex items-center justify-between gap-3">
<h3 className="text-muted-foreground text-sm font-medium">{title}</h3>
<DropdownMenu>
<DropdownMenuTrigger
render={
<Button
                  variant="ghost"
                  size="icon"
                  className="-me-1.5"
                  aria-label="More options"
                />
} >
<MoreHorizontalIcon  aria-hidden="true" />
</DropdownMenuTrigger>
<DropdownMenuContent align="end" className="w-48">
<DropdownMenuGroup>
<DropdownMenuItem>
<SettingsIcon  aria-hidden="true" />
Settings
</DropdownMenuItem>
<DropdownMenuItem>
<TriangleAlertIcon  aria-hidden="true" />
Add Alert
</DropdownMenuItem>
<DropdownMenuItem>
<PinIcon  aria-hidden="true" />
Pin to Dashboard
</DropdownMenuItem>
<DropdownMenuItem>
<Share2Icon  aria-hidden="true" />
Share
</DropdownMenuItem>
<DropdownMenuSeparator />
<DropdownMenuItem variant="destructive">
<TrashIcon  aria-hidden="true" />
Remove
</DropdownMenuItem>
</DropdownMenuGroup>
</DropdownMenuContent>
</DropdownMenu>
</div>
<div className="space-y-2.5">
<div className="flex items-center gap-2.5">
<span className="text-foreground text-2xl font-medium tracking-tight tabular-nums">
{value}
</span>
<Badge variant={positive ? "success-light" : "destructive-light"}>
{positive ? (
<ArrowUpIcon  aria-hidden="true" />
) : (
<ArrowDownIcon  aria-hidden="true" />
)}
{delta}%
</Badge>
</div>
<Separator />
<div className="text-muted-foreground text-xs">
Vs last month:{" "}
<span className="text-foreground font-medium tabular-nums">
{lastMonth}
</span>
</div>
</div>
</CardContent>
</Card>
)
}
