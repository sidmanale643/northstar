import type { Metadata } from 'next'
import Link from 'next/link'
import { Radar } from 'lucide-react'

import styles from '@/components/launch/launch.module.css'

export const metadata: Metadata = {
  title: 'Blog — NorthStar',
  description: 'Technical writing from the NorthStar team.',
}

const posts = [
  {
    slug: 'introducing-northstar',
    title: 'NorthStar: trace the agent, not just the model call.',
    date: '2025-06-06',
    description:
      'A technical introduction to NorthStar, an observability and debugging platform for AI agents.',
  },
]

export default function BlogIndex() {
  return (
    <main className={styles.page}>
      <header className={styles.siteHeader}>
        <Link href="/blog" className={styles.brand} aria-label="NorthStar blog">
          <span className={styles.brandMark}>
            <Radar aria-hidden="true" />
          </span>
          <span>NorthStar / Blog</span>
        </Link>
      </header>

      <section className={styles.hero}>
        <div>
          <h1>Field notes.</h1>
          <p className={styles.heroDeck}>
            Technical writing on agent observability, debugging, and evaluation.
          </p>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionBody}>
          {posts.map((post) => (
            <Link
              key={post.slug}
              href={`/blog/${post.slug}`}
              className={styles.problemCard}
              style={{ textDecoration: 'none', color: 'inherit' }}
            >
              <time dateTime={post.date}>{post.date}</time>
              <strong>{post.title}</strong>
              <p>{post.description}</p>
            </Link>
          ))}
        </div>
      </section>
    </main>
  )
}
