'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Button } from './button';
import { cn } from '@/lib/utils';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode;
  iconSize?: number;
}

export function IconButton({ icon, iconSize = 16, className, ...props }: IconButtonProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn('p-1.5', className)}
      {...props}
    >
      {icon}
    </Button>
  );
}
