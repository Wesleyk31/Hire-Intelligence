import { useState, type FormEvent } from 'react';
import { api } from '@appdeploy/client';

export default function DemoRequestForm({
  compact = false,
}: {
  compact?: boolean;
}) {
  const [status, setStatus] = useState('');
  const [sending, setSending] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSending(true);
    setStatus('');
    try {
      const form = event.currentTarget;
      await api.post(
        '/api/demo-request',
        Object.fromEntries(new FormData(form).entries()),
      );
      form.reset();
      setStatus(
        'Request received. Your details have been recorded for follow-up.',
      );
    } catch {
      setStatus(
        'The request could not be recorded. Please check the required fields and try again.',
      );
    } finally {
      setSending(false);
    }
  };
  return (
    <form
      className={compact ? 'demo-form compact' : 'demo-form'}
      onSubmit={submit}
    >
      <label>
        Name
        <input name="name" required autoComplete="name" />
      </label>
      <label>
        Company
        <input name="company" required autoComplete="organization" />
      </label>
      <label>
        Business email
        <input name="email" required type="email" autoComplete="email" />
      </label>
      <label>
        Phone
        <input name="phone" autoComplete="tel" />
      </label>
      <label className="wide">
        What do you want to see?
        <textarea name="message" rows={compact ? 2 : 4} />
      </label>
      <input
        className="demo-honeypot"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
      />
      <button type="submit" disabled={sending}>
        {sending ? 'Sending…' : 'Request demo'}
      </button>
      {status && <p className="demo-status">{status}</p>}
    </form>
  );
}
