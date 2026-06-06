'use client'

import { Suspense, useState, type FormEvent } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { GoogleIcon } from '@/components/ui/google-icon'
import { Loader2, ArrowLeft, CheckCircle2, Mail } from 'lucide-react'

type View = 'signin' | 'signup' | 'forgot-password' | 'check-email' | 'reset-email-sent'

const ERROR_MESSAGES: Record<string, string> = {
  access_denied: 'Access was denied. Please try again.',
  otp_expired: 'Your sign-in link has expired. Please request a new one.',
  invite_expired: 'This invite link has expired.',
  verification_failed: 'We could not verify your sign-in. Please try again.',
}

const SUPABASE_ERROR_MAP: Record<string, string> = {
  'Invalid login credentials': 'Incorrect email or password.',
  'User already registered': 'An account with this email already exists.',
  'Password should be at least 6 characters': 'Password must be at least 6 characters.',
  'Unable to validate email address: invalid format': 'Please enter a valid email address.',
  'Email not confirmed': 'Please verify your email address before signing in.',
  'For security purposes, you can only request this once every 60 seconds':
    'Please wait a minute before trying again.',
}

function getFriendlyError(message: string): string {
  for (const [key, friendly] of Object.entries(SUPABASE_ERROR_MAP)) {
    if (message.toLowerCase().includes(key.toLowerCase())) return friendly
  }
  return message
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageContent />
    </Suspense>
  )
}

function LoginPageContent() {
  const searchParams = useSearchParams()
  const initialView: View = searchParams.get('mode') === 'signup' ? 'signup' : 'signin'
  const nextPath = searchParams.get('next') ?? '/projects'
  const urlError = searchParams.get('error')

  const [view, setView] = useState<View>(initialView)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [error, setError] = useState(urlError ? ERROR_MESSAGES[urlError] ?? urlError : '')

  const getRedirectTo = () =>
    `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`

  const withClient = async (
    fn: (supabase: ReturnType<typeof createClient>) => Promise<void>
  ) => {
    try {
      const supabase = createClient()
      await fn(supabase)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Something went wrong. Please try again.'
      setError(getFriendlyError(message))
    }
  }

  const handleEmailAuth = async (e: FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    await withClient(async (supabase) => {
      if (view === 'signup') {
        const { error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: getRedirectTo() },
        })
        if (signUpError) {
          setError(getFriendlyError(signUpError.message))
        } else {
          setView('check-email')
        }
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        })
        if (signInError) {
          setError(getFriendlyError(signInError.message))
        } else {
          window.location.href = nextPath
        }
      }
    })

    setLoading(false)
  }

  const handleForgotPassword = async (e: FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    await withClient(async (supabase) => {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`,
      })
      if (resetError) {
        setError(getFriendlyError(resetError.message))
      } else {
        setView('reset-email-sent')
      }
    })

    setLoading(false)
  }

  const handleGoogle = async () => {
    setGoogleLoading(true)
    setError('')

    await withClient(async (supabase) => {
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: getRedirectTo() },
      })
      if (oauthError) {
        setError(getFriendlyError(oauthError.message))
        setGoogleLoading(false)
      }
    })

    if (!error) setGoogleLoading(false)
  }

  const goToSignIn = () => {
    setView('signin')
    setError('')
    setPassword('')
  }

  const goToSignUp = () => {
    setView('signup')
    setError('')
    setPassword('')
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">NorthStar</CardTitle>
          <CardDescription>
            {view === 'signin' && 'Sign in to your account'}
            {view === 'signup' && 'Create a new account'}
            {view === 'forgot-password' && 'Reset your password'}
            {view === 'check-email' && 'Verify your email'}
            {view === 'reset-email-sent' && 'Check your inbox'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive" role="alert">
              {error}
            </div>
          )}

          {view === 'check-email' && (
            <div className="flex flex-col items-center gap-4 py-6">
              <div className="rounded-full bg-primary/10 p-3">
                <Mail className="h-6 w-6 text-primary" />
              </div>
              <div className="text-center">
                <p className="text-sm text-muted-foreground">
                  We sent a verification link to
                </p>
                <p className="mt-1 font-medium text-foreground">{email}</p>
                <p className="mt-3 text-sm text-muted-foreground">
                  Click the link to activate your account, then sign in.
                </p>
              </div>
              <Button variant="outline" className="w-full" onClick={goToSignIn}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to sign in
              </Button>
            </div>
          )}

          {view === 'reset-email-sent' && (
            <div className="flex flex-col items-center gap-4 py-6">
              <div className="rounded-full bg-primary/10 p-3">
                <CheckCircle2 className="h-6 w-6 text-primary" />
              </div>
              <div className="text-center">
                <p className="text-sm text-muted-foreground">
                  Password reset link sent to
                </p>
                <p className="mt-1 font-medium text-foreground">{email}</p>
                <p className="mt-3 text-sm text-muted-foreground">
                  Click the link in your email to set a new password.
                </p>
              </div>
              <Button variant="outline" className="w-full" onClick={goToSignIn}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to sign in
              </Button>
            </div>
          )}

          {(view === 'signin' || view === 'signup') && (
            <>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={handleGoogle}
                disabled={googleLoading || loading}
              >
                {googleLoading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <GoogleIcon className="mr-2" />
                )}
                Continue with Google
              </Button>

              <div className="my-4 flex items-center gap-3">
                <div className="h-px flex-1 bg-border" />
                <span className="text-xs uppercase tracking-wide text-muted-foreground">
                  or
                </span>
                <div className="h-px flex-1 bg-border" />
              </div>

              <form onSubmit={handleEmailAuth} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder={view === 'signup' ? 'At least 6 characters' : '••••••••'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                    autoComplete={view === 'signup' ? 'new-password' : 'current-password'}
                  />
                  {view === 'signin' && (
                    <button
                      type="button"
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() => {
                        setView('forgot-password')
                        setError('')
                        setPassword('')
                      }}
                    >
                      Forgot password?
                    </button>
                  )}
                </div>
                <Button type="submit" className="w-full" disabled={loading || googleLoading}>
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {view === 'signin' ? 'Sign in' : 'Create account'}
                </Button>
              </form>

              <p className="mt-4 text-center text-sm text-muted-foreground">
                {view === 'signin' ? (
                  <>
                    Don&apos;t have an account?{' '}
                    <button
                      type="button"
                      className="font-medium text-foreground underline-offset-4 hover:underline"
                      onClick={goToSignUp}
                    >
                      Sign up
                    </button>
                  </>
                ) : (
                  <>
                    Already have an account?{' '}
                    <button
                      type="button"
                      className="font-medium text-foreground underline-offset-4 hover:underline"
                      onClick={goToSignIn}
                    >
                      Sign in
                    </button>
                  </>
                )}
              </p>
            </>
          )}

          {view === 'forgot-password' && (
            <>
              <p className="mb-4 text-sm text-muted-foreground">
                Enter your email and we&apos;ll send you a link to reset your password.
              </p>
              <form onSubmit={handleForgotPassword} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="reset-email">Email</Label>
                  <Input
                    id="reset-email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                    autoFocus
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Send reset link
                </Button>
              </form>
              <button
                type="button"
                className="mt-4 flex w-full items-center justify-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
                onClick={goToSignIn}
              >
                <ArrowLeft className="h-3 w-3" />
                Back to sign in
              </button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
