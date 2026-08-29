"use client";

import { useState, type InputHTMLAttributes } from "react";
import { TextInput, cx } from "@/components/ui";
import { Icon } from "@/components/icons";

/** Password field with a show/hide toggle at the right edge. */
export function PasswordInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <TextInput
        {...rest}
        type={visible ? "text" : "password"}
        className={cx("pr-10", className)}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "パスワードを隠す" : "パスワードを表示"}
        className="absolute inset-y-0 right-0 grid w-10 place-items-center text-ink-3 hover:text-ink"
      >
        <Icon name={visible ? "eyeOff" : "eye"} className="h-4 w-4" />
      </button>
    </div>
  );
}
