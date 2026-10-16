import { api, json } from './lib'

export type AccessStatus = {
  authenticated: boolean
  passkey_available: boolean
  passkey_supported: boolean
  passkey_count: number
}

export const supportsPasskeys = () => window.isSecureContext && !!window.PublicKeyCredential

function fromBase64(value: string): ArrayBuffer {
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(binary, character => character.charCodeAt(0)).buffer
}
function toBase64(value: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(value))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function serialize(credential: PublicKeyCredential) {
  const response = credential.response
  const common = { id: credential.id, rawId: toBase64(credential.rawId), type: credential.type, authenticatorAttachment: credential.authenticatorAttachment, clientExtensionResults: credential.getClientExtensionResults() }
  if (response instanceof AuthenticatorAttestationResponse) {
    return { ...common, response: { clientDataJSON: toBase64(response.clientDataJSON), attestationObject: toBase64(response.attestationObject), transports: response.getTransports() } }
  }
  const assertion = response as AuthenticatorAssertionResponse
  return { ...common, response: { clientDataJSON: toBase64(assertion.clientDataJSON), authenticatorData: toBase64(assertion.authenticatorData), signature: toBase64(assertion.signature), userHandle: assertion.userHandle ? toBase64(assertion.userHandle) : null } }
}

type EncodedDescriptor = Omit<PublicKeyCredentialDescriptor, 'id'> & { id: string }
function descriptor(value: EncodedDescriptor): PublicKeyCredentialDescriptor {
  return { ...value, id: fromBase64(value.id) }
}

export async function usePasskey(register = false) {
  if (!supportsPasskeys()) throw new Error('Passkey cần HTTPS hoặc localhost và trình duyệt hỗ trợ.')
  const path = '/auth/passkey/' + (register ? 'register' : 'login')
  let credential: Credential | null
  if (register) {
    type Encoded = Omit<PublicKeyCredentialCreationOptions, 'challenge' | 'user' | 'excludeCredentials'> & { challenge: string; user: Omit<PublicKeyCredentialUserEntity, 'id'> & { id: string }; excludeCredentials?: EncodedDescriptor[] }
    const { publicKey } = await api<{ publicKey: Encoded }>(path + '/begin', json('POST', {}))
    credential = await navigator.credentials.create({ publicKey: { ...publicKey, challenge: fromBase64(publicKey.challenge), user: { ...publicKey.user, id: fromBase64(publicKey.user.id) }, excludeCredentials: publicKey.excludeCredentials?.map(descriptor) } })
  } else {
    type Encoded = Omit<PublicKeyCredentialRequestOptions, 'challenge' | 'allowCredentials'> & { challenge: string; allowCredentials?: EncodedDescriptor[] }
    const { publicKey } = await api<{ publicKey: Encoded }>(path + '/begin', json('POST', {}))
    credential = await navigator.credentials.get({ publicKey: { ...publicKey, challenge: fromBase64(publicKey.challenge), allowCredentials: publicKey.allowCredentials?.map(descriptor) } })
  }
  if (!credential) throw new Error('Chưa hoàn tất xác thực passkey.')
  await api(path + '/finish', json('POST', serialize(credential as PublicKeyCredential)))
}

export function accessError(error: unknown) {
  if (error instanceof DOMException && error.name === 'NotAllowedError') return 'Đã hủy hoặc hết thời gian xác thực. Bạn có thể thử lại hoặc dùng mật khẩu.'
  if (error instanceof DOMException && error.name === 'SecurityError') return 'Địa chỉ hiện tại chưa phù hợp với cấu hình passkey. Hãy mở đúng tên miền HTTPS đã cấu hình.'
  if (error instanceof DOMException && error.name === 'InvalidStateError') return 'Thiết bị này đã có passkey cho ứng dụng.'
  return error instanceof Error ? error.message : 'Không thể xác thực. Vui lòng thử lại.'
}
