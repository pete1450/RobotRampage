#!/usr/bin/env python3
"""Assemble robot-rampage/index.html: head + three.min.js + logic.js + game.js + foot.

Usage: python3 build.py [output-path]
Defaults to index.html next to this script.
"""
import pathlib
import sys

HERE = pathlib.Path(__file__).parent
head = (HERE / 'head.html').read_text()
three = (HERE / 'three.min.js').read_text()
logic = (HERE / 'logic.js').read_text()
game = (HERE / 'game.js').read_text()
out = head + three + '\n</script>\n<script>\n' + logic + '\n' + game + '\n</script>\n</body>\n</html>\n'

dest = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / 'index.html'
dest.write_text(out)
print('wrote', dest, len(out), 'bytes')
