// build.js

import fs from 'fs-extra'
import path from 'path'
import obfuscator from 'javascript-obfuscator'

const srcDir = path.resolve('src')
const distDir = path.resolve('dist')

/**
 * Obfusque un fichier JS
 */
function obfuscateJSFile(filePath, destPath, extraOptions = {}) {
  const code = fs.readFileSync(filePath, 'utf8')
  const obfuscatedCode = obfuscator.obfuscate(code, {
    compact: true,
    controlFlowFlattening: true,         // 	Peut briser la logique de certains frameworks
    deadCodeInjection: true,             // - Injecte du code inutile et fragilise l'exécution dynamique
    stringArrayEncoding: ['base64'],      // OK, mais léger impact perf
    transformObjectKeys: true,           //  très risqué avec Chart.js (Peut casser les clés attendues par des bibliothèques, surtout quand elles accèdent aux propriétés par nom)
    unicodeEscapeSequence: true,         //  plus lisible, plus sûr (Rend les chaînes illisibles et parfois mal gérées par certaines APIs)
    selfDefending: true ,                 // facultatif - Anti-modification / anti-debug
    ...extraOptions // ← ⚠️ ceci surcharge les options si on en passe via copyAndProcessFiles
  }).getObfuscatedCode()

  fs.outputFileSync(destPath, obfuscatedCode)
}

/**
 * Copie les fichiers avec traitement JS
 */
async function copyAndProcessFiles(src, dest) {
  const entries = await fs.readdir(src, { withFileTypes: true })

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)

    if (entry.isDirectory()) {
      await copyAndProcessFiles(srcPath, destPath)
    } else if (
      entry.name.endsWith('.js') &&
      !entry.name.endsWith('.min.js') &&
      !entry.name.startsWith('+') &&
      !entry.name.includes('charttest') // <-- exclut les fichiers "charttest"
    ) {
      const isVendor = srcPath.includes(`${path.sep}vendor${path.sep}`) // vérifie si le fichier est dans /vendor/
      obfuscateJSFile(srcPath, destPath, {
        controlFlowFlattening: !isVendor,
        deadCodeInjection: !isVendor,
        transformObjectKeys: !isVendor
      })
    } else if (entry.name.endsWith('.map') || entry.name.startsWith('.')) {
      // Ignore les fichiers source map ou cachés
      continue
    } else {
      await fs.copy(srcPath, destPath)
    }
  }
}

async function build() {
  console.log('🔧 Nettoyage du dossier dist/…')
  await fs.remove(distDir)

  console.log('📦 Copie et obfuscation en cours…')
  await copyAndProcessFiles(srcDir, distDir)

  console.log('✅ Build terminé. Dossier prêt : dist/')
}

build().catch(err => {
  console.error('❌ Erreur pendant le build :', err)
  process.exit(1)
})
