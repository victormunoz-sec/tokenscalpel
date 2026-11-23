import sys, json, tiktoken
enc = tiktoken.get_encoding("cl100k_base")
data = json.loads(sys.stdin.read())
counts = [len(enc.encode(t)) for t in data]
sys.stdout.write(json.dumps(counts))
