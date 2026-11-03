"""Inspect a pinned historical MIT tree without extracting or running upstream code."""
import io
import tarfile
import urllib.request

COMMIT = 'e79b430cc27b63c690b5d782b045c213b9a873c5'
if __name__ == '__main__':
    data = urllib.request.urlopen(f'https://codeload.github.com/Alishahryar1/free-claude-code/tar.gz/{COMMIT}', timeout=60).read()
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
        for member in archive.getmembers():
            if member.isfile() and (member.name.endswith('/LICENSE') or member.name.split('/', 1)[-1] in {'config/logging_config.py', 'api/gateway_model_ids.py', 'core/rate_limit.py', 'providers/rate_limit.py'}):
                print('\nFILE', member.name)
                source = archive.extractfile(member)
                assert source is not None
                print(source.read().decode())
