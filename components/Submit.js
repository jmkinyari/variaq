"use client";
import { useFormStatus } from "react-dom";
export default function Submit({ children, className = "btn primary", confirm, pendingText = "Working…", ...rest }) {
  const { pending } = useFormStatus();
  return (
    <button className={className} disabled={pending} onClick={(e) => { if (confirm && !window.confirm(confirm)) e.preventDefault(); }} {...rest}>
      {pending ? pendingText : children}
    </button>
  );
}
