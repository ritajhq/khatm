import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react'
import { cn } from './utils.ts'

export function Table(
  { className, ...props }: HTMLAttributes<HTMLTableElement>,
) {
  return (
    <div className='relative w-full overflow-x-auto'>
      <table
        className={cn('w-full caption-bottom text-sm', className)}
        {...props}
      />
    </div>
  )
}

export function TableHeader(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className='[&_tr]:border-b' {...props} />
}

export function TableBody(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className='[&_tr:last-child]:border-0' {...props} />
}

export function TableRow(
  { className, ...props }: HTMLAttributes<HTMLTableRowElement>,
) {
  return (
    <tr
      className={cn('border-b transition-colors hover:bg-muted/50', className)}
      {...props}
    />
  )
}

export function TableHead(
  { className, ...props }: ThHTMLAttributes<HTMLTableCellElement>,
) {
  return (
    <th
      className={cn(
        'h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-muted-foreground',
        className,
      )}
      {...props}
    />
  )
}

export function TableCell(
  { className, ...props }: TdHTMLAttributes<HTMLTableCellElement>,
) {
  return <td className={cn('p-2 align-middle', className)} {...props} />
}
