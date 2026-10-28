"""비밀번호가 걸린 엑셀 시험 파일을 만든다 (가상 데이터).

실제 은행·간편결제 앱이 주는 파일과 같은 암호화 방식 세 가지:
  bank-standard.xlsx     ECMA-376 표준, AES-128 + SHA-1 (토스뱅크 거래내역과 같은 방식)
  bank-agile-sha1.xlsx   ECMA-376 에자일, AES-128 + SHA-1 (카카오페이 머니 거래내역과 같은 방식)
  bank-agile-sha512.xlsx ECMA-376 에자일, AES-256 + SHA-512 (엑셀에서 직접 암호를 걸 때의 기본값)
비밀번호는 모두 test1234. 엔진의 복호화 코드와 별개인 msoffcrypto-tool로 암호화하고, 다시 풀어서 확인한다.

    pip install msoffcrypto-tool openpyxl
    python make-encrypted.py
"""

import io
import os
from datetime import datetime
from hashlib import sha1
from struct import pack

import msoffcrypto
import openpyxl
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from msoffcrypto.method import ecma376_agile
from msoffcrypto.method.container.ecma376_encrypted import ECMA376Encrypted
from msoffcrypto.method.ecma376_agile import ECMA376Agile

PASSWORD = "test1234"
HERE = os.path.dirname(os.path.abspath(__file__))


def plain_workbook() -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "거래내역"
    ws.append([None, "가상 은행 거래내역"])
    ws.append([None, "성명", "홍길동"])
    ws.append([])
    ws.append([None, "거래 일시", "적요", "거래 유형", "거래 금액", "거래 후 잔액", "처리일"])
    ws.append([None, "2026.10.01 09:00:00", "넷플릭스", "체크카드결제", -13500, 86500, datetime(2026, 10, 1, 9, 0, 0)])
    ws.append([None, "2026.09.30 12:00:00", "홍길동", "입금", 100000, 100000, datetime(2026, 9, 30)])
    ws["H6"].number_format = "yyyy-mm-dd"
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


def aes_ecb(key: bytes, data: bytes) -> bytes:
    enc = Cipher(algorithms.AES(key), modes.ECB()).encryptor()
    return enc.update(data) + enc.finalize()


def encrypt_standard(plain: bytes, password: str) -> bytes:
    """[MS-OFFCRYPTO] 2.3.4.5~2.3.4.9 표준 암호화. msoffcrypto-tool은 이 방식의 복호화만 지원해서 직접 만든다."""
    salt = os.urandom(16)
    h = sha1(salt + password.encode("utf-16le")).digest()
    for i in range(50000):
        h = sha1(pack("<I", i) + h).digest()
    h = sha1(h + pack("<I", 0)).digest()

    def derive(byte: int) -> bytes:
        buf = bytearray([byte] * 64)
        for i, x in enumerate(h):
            buf[i] ^= x
        return sha1(bytes(buf)).digest()

    key = (derive(0x36) + derive(0x5C))[:16]
    verifier = os.urandom(16)
    verifier_hash = sha1(verifier).digest() + bytes(12)
    csp = "Microsoft Enhanced RSA and AES Cryptographic Provider".encode("utf-16le") + b"\0\0"
    header = pack("<IIIIIIII", 0x24, 0, 0x660E, 0x8004, 128, 0x18, 0, 0) + csp
    info = (
        pack("<HHI", 4, 2, 0x24)
        + pack("<I", len(header))
        + header
        + pack("<I", 16)
        + salt
        + aes_ecb(key, verifier)
        + pack("<I", 20)
        + aes_ecb(key, verifier_hash)
    )
    package = pack("<Q", len(plain)) + aes_ecb(key, plain + bytes(-len(plain) % 16))
    out = io.BytesIO()
    ECMA376Encrypted(package, info).write_to(out)
    return out.getvalue()


def encrypt_agile(plain: bytes, password: str, hash_name: str, key_bits: int) -> bytes:
    """msoffcrypto-tool의 에자일 암호화는 AES-256 + SHA-512 고정이라, 매개변수 기본값을 바꿔서 부른다.
    SHA-1 해시(20바이트)는 AES 블록(16바이트)에 맞지 않아, 암호화 전에 0으로 채우게 한다 (엑셀도 그렇게 저장한다)."""
    original_init = ecma376_agile.ECMA376AgileCipherParams.__init__
    original_cbc = ecma376_agile._encrypt_aes_cbc

    def patched_init(self):
        original_init(self)
        self.hashName = hash_name
        self.keyBits = key_bits
        self.hashSize = {"SHA1": 20, "SHA512": 64}[hash_name]

    ecma376_agile.ECMA376AgileCipherParams.__init__ = patched_init
    ecma376_agile._encrypt_aes_cbc = lambda data, key, iv: original_cbc(data + bytes(-len(data) % 16), key, iv)
    try:
        return ECMA376Agile.encrypt(password, io.BytesIO(plain))
    finally:
        ecma376_agile.ECMA376AgileCipherParams.__init__ = original_init
        ecma376_agile._encrypt_aes_cbc = original_cbc


def check(data: bytes, plain: bytes) -> None:
    f = msoffcrypto.OfficeFile(io.BytesIO(data))
    f.load_key(password=PASSWORD)
    out = io.BytesIO()
    f.decrypt(out)
    assert out.getvalue()[: len(plain)] == plain, "다시 풀었더니 원본과 다릅니다"


def main() -> None:
    plain = plain_workbook()
    files = {
        "bank-plain.xlsx": plain,
        "bank-standard.xlsx": encrypt_standard(plain, PASSWORD),
        "bank-agile-sha1.xlsx": encrypt_agile(plain, PASSWORD, "SHA1", 128),
        "bank-agile-sha512.xlsx": encrypt_agile(plain, PASSWORD, "SHA512", 256),
    }
    for name, data in files.items():
        if name != "bank-plain.xlsx":
            check(data, plain)
        with open(os.path.join(HERE, name), "wb") as f:
            f.write(data)
        print(name, len(data))


if __name__ == "__main__":
    main()
