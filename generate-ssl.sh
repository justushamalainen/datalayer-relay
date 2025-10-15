#!/bin/sh
set -e

# SSL certificate generation script
# Automatically generates self-signed certificates if they don't exist

SSL_DIR="/ssl"
CERT_FILE="${SSL_DIR}/localhost.crt"
KEY_FILE="${SSL_DIR}/localhost.key"

echo "🔒 Checking SSL certificates..."

# Create ssl directory if it doesn't exist
mkdir -p "${SSL_DIR}"

# Check if certificates already exist
if [ -f "${CERT_FILE}" ] && [ -f "${KEY_FILE}" ]; then
    echo "✅ SSL certificates already exist"
    echo "   Certificate: ${CERT_FILE}"
    echo "   Key: ${KEY_FILE}"

    # Check if certificates are still valid
    if openssl x509 -checkend 86400 -noout -in "${CERT_FILE}" > /dev/null 2>&1; then
        echo "✅ Certificates are valid (more than 1 day remaining)"
    else
        echo "⚠️  Certificates are expiring soon or expired"
        echo "   Regenerating certificates..."
        rm -f "${CERT_FILE}" "${KEY_FILE}"
    fi
fi

# Generate certificates if they don't exist
if [ ! -f "${CERT_FILE}" ] || [ ! -f "${KEY_FILE}" ]; then
    echo "🔧 Generating new self-signed SSL certificates..."

    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout "${KEY_FILE}" \
        -out "${CERT_FILE}" \
        -subj "/C=US/ST=State/L=City/O=Development/CN=localhost" \
        -addext "subjectAltName=DNS:localhost,DNS:*.localhost,IP:127.0.0.1" \
        2>/dev/null || {
            # Fallback for older OpenSSL versions without -addext
            openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
                -keyout "${KEY_FILE}" \
                -out "${CERT_FILE}" \
                -subj "/C=US/ST=State/L=City/O=Development/CN=localhost"
        }

    # Set appropriate permissions
    chmod 644 "${CERT_FILE}"
    chmod 600 "${KEY_FILE}"

    echo "✅ SSL certificates generated successfully!"
    echo "   Certificate: ${CERT_FILE}"
    echo "   Key: ${KEY_FILE}"
    echo "   Valid for: 365 days"
fi

echo "✅ SSL setup complete"
