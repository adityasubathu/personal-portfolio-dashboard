import { toast } from 'sonner'

export const notify = {
  success: (message: string, title?: string) => toast.success(title ?? message, title ? { description: message } : undefined),
  error: (message: string, title?: string) => toast.error(title ?? message, title ? { description: message } : undefined),
  info: (message: string, title?: string) => toast(title ?? message, title ? { description: message } : undefined),
  warning: (message: string, title?: string) => toast.warning(title ?? message, title ? { description: message } : undefined),
  withAction: (
    type: 'success' | 'error',
    title: string,
    description: string | undefined,
    action: { label: string; onClick: () => void },
  ) => toast[type](title, { description, action }),
}
