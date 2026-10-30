import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { errorMessage } from '@/lib/api';
import Splash from './Splash';

export default function AuthCallback() {
  const [params] = useSearchParams();
  const { completeWebLogin } = useAuth();
  const nav = useNavigate();
  const [err, setErr] = useState<string | null>(null);
  const once = useRef(false);

  useEffect(() => {
    if (once.current) return;
    once.current = true;
    const code = params.get('code');
    if (!code) {
      nav('/login?error=' + encodeURIComponent('Sign-in failed. Please try again.'), { replace: true });
      return;
    }
    completeWebLogin(code)
      .then(() => nav('/', { replace: true }))
      .catch((e) => {
        setErr(errorMessage(e));
        nav('/login?error=' + encodeURIComponent(errorMessage(e)), { replace: true });
      });
  }, [params, completeWebLogin, nav]);

  return <Splash error={err ?? undefined} />;
}
