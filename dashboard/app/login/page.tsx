'use client'

import { Suspense, useState, type FormEvent } from 'react'
import Link from 'next/link'
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
import { Loader2 } from 'lucide-react'

type Mode = 'signin' | 'signup'

const ERROR_MESSAGES: Record<string, string> = {
  access_denied: 'Access was denied. Please try again.',
  otp_expired: 'Your sign-in link has expired. Please request a new one.',
  invite_expired: 'This invite link has expired.',
  verification_failed: 'We could not verify your sign-in. Please try again.',
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
  const initialMode: Mode = searchParams.get('mode') === 'signup' ? 'signup' : 'signin'
  const nextPath = searchParams.get('next') ?? '/projects'
  const urlError = searchParams.get('error')

  const [mode, setMode] = useState<Mode>(initialMode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState(urlError ? ERROR_MESSAGES[urlError] ?? urlError : '')

  const redirectTo = `${location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`

  const handleEmailAuth = async (e: FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setMessage('')
    setError('')

    const supabase = createClient()

    if (mode === 'signup') {
      const { error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: redirectTo },
      })
      if (signUpError) {
        setError(signUpError.message)
      } else {
        setMessage('Check your email to confirm your account, then sign in.')
        setMode('signin')
      }
    } else {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      })
      if (signInError) {
        setError(signInError.message)
      } else {
        window.location.href = nextPath
      }
    }

    setLoading(false)
  }

  const handleGoogle = async () => {
    setGoogleLoading(true)
    setError('')
    const supabase = createClient()
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    })
    if (oauthError) {
      setError(oauthError.message)
      setGoogleLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">NorthStar</CardTitle>
          <CardDescription>
            {mode === 'signin'
              ? 'Sign in to access the dashboard'
              : 'Create an account to get started'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-4 grid grid-cols-2 rounded-md border border-border/60 bg-muted/40 p-1 text-sm">
            <button
              type="button"
              onClick={() => {
                setMode('signin')
                setError('')
                setMessage('')
              }}
              className={
                'rounded-sm py-1.5 font-medium transition-colors ' +
                (mode === 'signin'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground')
              }
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('signup')
                setError('')
                setMessage('')
              }}
              className={
                'rounded-sm py-1.5 font-medium transition-colors ' +
                (mode === 'signup'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground')
              }
            >
              Sign up
            </button>
          </div>

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
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading || googleLoading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {mode === 'signin' ? 'Sign in' : 'Create account'}
            </Button>
          </form>

          {error && (
            <p className="mt-3 text-sm text-destructive text-center" role="alert">
              {error}
            </p>
          )}
          {message && (
            <p className="mt-3 text-sm text-muted-foreground text-center">{message}</p>
          )}

          <p className="mt-4 text-center text-xs text-muted-foreground">
            {mode === 'signin' ? (
              <>
                New here?{' '}
                <button
                  type="button"
                  className="font-medium text-foreground underline-offset-4 hover:underline"
                  onClick={() => {
                    setMode('signup')
                    setError('')
                    setMessage('')
                  }}
                >
                  Create an account
                </button>
              </>
            ) : (
              <>
                Already have an account?{' '}
                <button
                  type="button"
                  className="font-medium text-foreground underline-offset-4 hover:underline"
                  onClick={() => {
                    setMode('signin')
                    setError('')
                    setMessage('')
                  }}
                >
                  Sign in
                </button>
              </>
            )}
            {' · '}
            <Link
              href="https://supabase.com/docs/guides/auth"
              target="_blank"
              rel="noreferrer"
              className="underline-offset-4 hover:underline"
            >
              Help
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
