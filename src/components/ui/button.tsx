import * as React from 'react';
import { cn } from '@/lib/utils';

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'outline' | 'ghost' | 'destructive';
  size?: 'default' | 'sm' | 'lg' | 'icon';
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', ...props }, ref) => {
    const variants = {
      default: 'bg-emerald-600 text-white hover:bg-emerald-500 shadow-xs',
      outline:
        'border border-slate-200 bg-white text-slate-800 hover:bg-slate-50',
      ghost: 'text-slate-700 hover:bg-slate-100',
      destructive: 'bg-rose-600 text-white hover:bg-rose-500',
    };
    const sizes = {
      default: 'h-10 px-4 py-2 text-xs font-bold rounded-xl',
      sm: 'h-8 px-3 text-xs font-bold rounded-lg',
      lg: 'h-12 px-6 text-sm font-black rounded-2xl',
      icon: 'h-9 w-9 rounded-xl flex items-center justify-center',
    };
    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center transition-all disabled:opacity-50 disabled:pointer-events-none active:scale-98',
          variants[variant],
          sizes[size],
          className
        )}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';
