#!/bin/bash
# This session's atlas docs, for atlas-chip. Prints "mtime<TAB>path" for each atlas
# .md or .html changed since the session started that sits in the repo's atlas folder
# or that the conversation mentions. Reads only the transcript bytes added since the
# last call; candidates and the offset live in ~/.cache/herdr-atlas.
# usage: docs.sh <transcript or -> <start epoch secs> <session cwd> <repo atlas dir or ->
set -u
T=$1 START=$2 CWD=$3 REPO=$4
C="$HOME/.cache/herdr-atlas"
mkdir -p "$C"
ID=$(basename "$T" .jsonl)
[ "$T" = - ] && ID=none
OFF="$C/$ID.off" CAND="$C/$ID.cand"
off=$(cat "$OFF" 2>/dev/null || echo 0)
size=$(stat -f %z "$T" 2>/dev/null || echo 0)
[ "$size" -lt "$off" ] && off=0 && : > "$CAND"
if [ "$T" != - ] && [ "$size" -gt "$off" ]; then
  # Paths ending .md or .html in any tool call or result, plus cd targets for
  # relative paths. Broad on purpose: the mtime check below drops what was only read.
  tail -c +$((off + 1)) "$T" | /opt/homebrew/bin/rg -o --no-filename --no-line-number \
    -e '\bcd +[~/][^ ;&|"\\)\x27`]+' \
    -e '[~A-Za-z0-9_./@+-]*[A-Za-z0-9_@+-]\.(?:md|html)\b' >> "$CAND"
  sort -u -o "$CAND" "$CAND"
  echo "$size" > "$OFF"
fi
exec /usr/bin/perl -MCwd=abs_path -MFile::Find -e '
  my ($start, $cwd, $repo, $cand) = @ARGV;
  my $home = $ENV{HOME};
  my $atlas = abs_path("$home/MEGA/Documents/atlas") // "$home/MEGA/Documents/atlas";
  my (%seen, @rel, @bases);
  push @bases, $cwd, "$home/MEGA/Documents/atlas";
  push @bases, $repo if $repo ne "-";
  sub keep { my $p = abs_path($_[0]) or return; return if $seen{$p};
    return unless index($p, "$atlas/") == 0 && $p !~ m{/evidence/} && $p !~ m{/index\.html$};
    my $m = (stat $p)[9] or return; return if $m < $start;
    $seen{$p} = 1; print "$m\t$p\n"; }
  if (open my $fh, "<", $cand) { while (<$fh>) { chomp; s{^~/}{$home/};
    # Published links: https://atlas.hadadus.me/r/<repo>/<path> is repos/<repo>/<path>.
    s{^//atlas\.hadadus\.me/r/}{$atlas/repos/};
    if (s/^cd +//) { push @bases, $_ if m{^/} } elsif (m{^/}) { keep($_) if -f } else { push @rel, $_ } } }
  # "atlas/x.md" was relative to some repo whose atlas link we may not have seen.
  my @repos = glob("$atlas/repos/*");
  for my $r (@rel) { for my $b (@bases) { keep("$b/$r") if -f "$b/$r" }
    if ($r =~ m{^atlas/(.+)}) { my $x = $1; for my $d (@repos) { keep("$d/$x") if -f "$d/$x" } } }
  if ($repo ne "-") { find({ no_chdir => 1, wanted => sub {
    if (-d && ($_ =~ m{/evidence$} || ($File::Find::name =~ tr{/}{}) - ($repo =~ tr{/}{}) > 3)) { $File::Find::prune = 1; return }
    keep($_) if /\.(md|html)$/ && -f } }, $repo) }
' "$START" "$CWD" "$REPO" "$CAND"
