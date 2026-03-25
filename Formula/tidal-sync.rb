class TidalSync < Formula
  desc "Tidal playlist sync CLI — Master quality"
  homepage "https://github.com/14h/tidal-sync"
  url "https://github.com/14h/tidal-sync/archive/refs/tags/v1.0.13.tar.gz"
  sha256 "ad994af83f5adcdae89ebd80b45c84f1dc25e13ff472e0f44a3fefe9aee4ee84"
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
