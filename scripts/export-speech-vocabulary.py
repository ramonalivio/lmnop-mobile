"""Export the publisher's SentencePiece model for Sherpa's native BPE encoder."""
import argparse
import hashlib
from pathlib import Path

import sentencepiece as spm

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('model', type=Path)
args = parser.parse_args()
expected = 'c53433de083c4a6ad12d034550ef22de68cec62c4f58932a7b6b8b2f1e743fa5'
if hashlib.sha256(args.model.read_bytes()).hexdigest() != expected:
    raise ValueError('Tokenizer does not match the bundled 2023-06-26 model')
processor = spm.SentencePieceProcessor(model_file=str(args.model))
vocabulary = ''.join(f'{processor.id_to_piece(i)}\t{processor.get_score(i)}\n'
                     for i in range(processor.get_piece_size()))
root = Path(__file__).resolve().parents[1]
# Android no longer bundles this retired model.
for assets in ['ios/LmnopMobile/models']:
    folder = root / assets / 'sherpa-onnx-streaming-zipformer-en-2023-06-26'
    tokens = {line.rsplit(' ', 1)[0] for line in (folder / 'tokens.txt').read_text().splitlines()}
    pieces = {processor.id_to_piece(i) for i in range(processor.get_piece_size())
              if not processor.is_control(i) and not processor.is_unknown(i)}
    if not pieces.issubset(tokens):
        raise ValueError('Tokenizer pieces do not match recognition tokens')
    (folder / 'bpe.vocab').write_text(vocabulary)
    print(f'Exported {folder / "bpe.vocab"}')
