# Suivi lait — déploiement Vercel

Option A (le plus simple) : https://vercel.com/new → "Deploy" sans Git → glisser ce dossier.

Option B (CLI) :
    npm i -g vercel
    cd suivi-lait
    vercel --prod

Aucun build : site statique. Données stockées dans IndexedDB sur chaque appareil.
