import { Info } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

/** Click-to-open explainer popover. `children` overrides the default info-icon trigger. */
export function InfoPopover({ text, children, className }: { text: string; children?: ReactNode; className?: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        {children ?? (
          <Button variant="ghost" size="icon-xs" aria-label="How these numbers are computed">
            <Info className="size-4 text-muted-foreground" />
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent className={cn('w-80', className)} align="start">
        <p className="text-xs leading-relaxed whitespace-pre-line">{text}</p>
      </PopoverContent>
    </Popover>
  )
}
