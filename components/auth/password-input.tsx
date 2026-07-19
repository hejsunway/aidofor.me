// filepath: components/auth/password-input.tsx
// Password input with show/hide toggle. Controlled by the parent form.
"use client";

import { useState, type InputHTMLAttributes } from "react";
import { Eye, EyeOff } from "lucide-react";

type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  label: string;
  hint?: React.ReactNode;
};

export function PasswordInput({ label, hint, id, ...rest }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  const inputId = id ?? `pw-${label.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <label htmlFor={inputId} className="auth-field">
      <span>{label}</span>
      <div className="auth-input-row">
        <input
          id={inputId}
          type={visible ? "text" : "password"}
          {...rest}
        />
        <button
          type="button"
          className="auth-eye"
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          onClick={() => setVisible((v) => !v)}
        >
          {visible ? <EyeOff size={17} /> : <Eye size={17} />}
        </button>
      </div>
      {hint ? <small className="auth-hint">{hint}</small> : null}
    </label>
  );
}