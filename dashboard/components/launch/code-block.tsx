import { CopyButton } from './copy-button'
import styles from './launch.module.css'

export function CodeBlock({
  code,
  language,
  label,
}: {
  code: string
  language: string
  label: string
}) {
  return (
    <div className={styles.codeBlock}>
      <div className={styles.codeHeader}>
        <span>{label}</span>
        <span className={styles.codeLanguage}>{language}</span>
        <CopyButton value={code} compact />
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  )
}
