import { useState, type ComponentProps, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Loader2 } from 'lucide-react'

type ButtonVariant = ComponentProps<typeof Button>['variant']
type ButtonSize = ComponentProps<typeof Button>['size']

const KNOWN_VARIANTS: ButtonVariant[] = ['default', 'destructive', 'outline', 'secondary', 'ghost', 'link']

function resolveVariant(variant: unknown, color: unknown): ButtonVariant {
  if (typeof variant === 'string' && (KNOWN_VARIANTS as string[]).includes(variant)) return variant as ButtonVariant
  if (color === 'red') return 'destructive'
  return 'outline'
}

interface ConfirmActionButtonProps {
  confirmTitle: string
  confirmDescription: ReactNode
  onConfirm: () => Promise<unknown> | unknown
  confirmLabel?: string
  children: ReactNode
  // 'subtle' and 'light' are legacy Mantine variant names from unmigrated call sites, mapped to a shadcn equivalent.
  variant?: ButtonVariant | 'subtle' | 'light'
  size?: ButtonSize
  className?: string
  // Legacy Mantine props (color, leftSection, old variant names) from unmigrated call sites; ignored here.
  [legacyProp: string]: unknown
}

export function ConfirmActionButton({
  confirmTitle,
  confirmDescription,
  onConfirm,
  confirmLabel = 'Confirm',
  children,
  variant,
  size,
  className,
  color,
  ...legacy
}: ConfirmActionButtonProps) {
  void legacy
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const resolvedVariant = resolveVariant(variant, color)

  async function confirm() {
    setPending(true)
    try {
      await onConfirm()
      setOpen(false)
    } catch {
      // callers retain notification handling
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <Button variant={resolvedVariant} size={size} className={className} onClick={() => setOpen(true)}>
        {children}
      </Button>
      <Dialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirmTitle}</DialogTitle>
            <DialogDescription>{confirmDescription}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button variant={resolvedVariant} onClick={confirm} disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
