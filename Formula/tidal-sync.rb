class TidalSync < Formula
  desc "Tidal playlist sync CLI — Master quality"
  homepage "https://github.com/14h/tidal-sync"
  url "https://github.com/14h/tidal-sync/archive/refs/tags/v1.0.20.tar.gz"
  sha256 "306b25a3d20b0e9306c725888dbe984fee84758a8b35e8ddff507c65243a20a2"
  license "Apache-2.0"

  depends_on "node"

  def install
    system "npm", "install"
    system "npm", "run", "build"

    libexec.install "dist", "node_modules", "package.json"

    (bin/"tidal-sync").write <<~EOS
      #!/bin/bash
      exec "#{Formula["node"].opt_bin}/node" "#{libexec}/dist/index.js" "$@"
    EOS
    chmod 0755, bin/"tidal-sync"
  end

  test do
    assert_match "Download Tidal playlists", shell_output("#{bin}/tidal-sync --help")
  end
end
