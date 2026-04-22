#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIST_ROOT="${ROOT_DIR}/dist"
PKG_NAME="datepgv-win10-oneclick"
PKG_DIR="${DIST_ROOT}/${PKG_NAME}"
ZIP_PATH="${DIST_ROOT}/${PKG_NAME}.zip"

echo "[package-mac] Preparing output folder..."
mkdir -p "${DIST_ROOT}"
rm -rf "${PKG_DIR}" "${ZIP_PATH}"
mkdir -p "${PKG_DIR}"

echo "[package-mac] Copying backend..."
rsync -a \
  --exclude ".venv" \
  --exclude ".tmp_req_check" \
  --exclude "__pycache__" \
  --exclude ".pytest_cache" \
  "${ROOT_DIR}/backend/" "${PKG_DIR}/backend/"

echo "[package-mac] Copying frontend..."
rsync -a \
  --exclude "node_modules" \
  --exclude ".next" \
  "${ROOT_DIR}/frontend/" "${PKG_DIR}/frontend/"

echo "[package-mac] Copying root files..."
if [[ -f "${ROOT_DIR}/.env" ]]; then
  cp "${ROOT_DIR}/.env" "${PKG_DIR}/"
else
  cp "${ROOT_DIR}/.env.example" "${PKG_DIR}/" || true
fi
cp "${ROOT_DIR}/.env.example" "${PKG_DIR}/" || true
cp "${ROOT_DIR}/run_win10_oneclick.bat" "${PKG_DIR}/"
cp "${ROOT_DIR}/run_win10_onclick.bat" "${PKG_DIR}/"
cp "${ROOT_DIR}/README.WINDOWS.md" "${PKG_DIR}/"

echo "[package-mac] Creating zip..."
(
  cd "${DIST_ROOT}"
  zip -qry "${PKG_NAME}.zip" "${PKG_NAME}"
)

echo "[package-mac] Done."
echo "[package-mac] Folder: ${PKG_DIR}"
echo "[package-mac] Zip: ${ZIP_PATH}"
