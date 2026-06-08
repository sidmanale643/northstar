import { Header } from '@/components/landing/Header'
import { Hero } from '@/components/landing/Hero'
import { Features } from '@/components/landing/Features'
import { CodeShowcase } from '@/components/landing/CodeShowcase'
import { WhyNorthStar } from '@/components/landing/WhyNorthStar'
import { CTA } from '@/components/landing/CTA'
import { Footer } from '@/components/landing/Footer'

export default function HomePage() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />
      <main className="flex-1">
        <Hero />
        <Features />
        <CodeShowcase />
        <WhyNorthStar />
        <CTA />
      </main>
      <Footer />
    </div>
  )
}
