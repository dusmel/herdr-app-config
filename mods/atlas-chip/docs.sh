#!/bin/bash
# This session's atlas docs and todos, for atlas-chip. Prints one line per item:
#   C <mtime> <last> <count> <path>   a doc the session changed: in the repo's atlas folder
#                                     and changed since the start, or named in one of the
#                                     session's own calls and changed within 15 minutes after
#   R <mtime> <last> <count> <path>   a doc the session named but didn't change, last named
#                                     in the past 7 days
#   T <id> <last> <count>             a todo the session started, finished, edited, moved
#                                     or archived (`atlas todo show` is a read: left out)
# <last> is when the session last named it (epoch secs), <count> how many of its calls did.
# Reads only the transcript bytes added since the last call; candidates ("epoch<TAB>text")
# and the offset live in ~/.cache/herdr-atlas.
# usage: docs.sh <transcript or -> <start epoch secs> <session cwd> <repo atlas dir or ->
set -u
T=$1 START=$2 CWD=$3 REPO=$4
C="$HOME/.cache/herdr-atlas"
mkdir -p "$C"
ID=$(basename "$T" .jsonl)
[ "$T" = - ] && ID=none
OFF="$C/$ID.off3" CAND="$C/$ID.cand3"
off=$(cat "$OFF" 2>/dev/null || echo 0)
size=$(stat -f %z "$T" 2>/dev/null || echo 0)
[ "$size" -lt "$off" ] && off=0 && : > "$CAND"
if [ "$T" != - ] && [ "$size" -gt "$off" ]; then
  # Paths ending .md or .html, cd targets for relative paths, and todo commands, from the
  # session's own messages only: a path in a tool result (a listing, a search) is not its work.
  tail -c +$((off + 1)) "$T" | /opt/homebrew/bin/rg -F --no-filename --no-line-number '"type":"assistant"' \
    | /usr/bin/perl -MTime::Local -ne '
      next unless /"timestamp":"(\d+)-(\d+)-(\d+)T(\d+):(\d+):(\d+)/;
      my $t = timegm($6, $5, $4, $3, $2 - 1, $1);
      print "$t\t$1\n" while m{\b(cd +[~/][^ ;&|"\\)\x27`]+)}g;
      print "$t\t\@todo:$1\n" while m{\batlas todo (?:start|done|edit|move|archive|unarchive|reopen) +#?(\d+)}g;
      print "$t\t$1\n" while m{(?<![~A-Za-z0-9_./\@+-])([~A-Za-z0-9_./\@+-]*[A-Za-z0-9_\@+-]\.(?:md|html))\b}g;' >> "$CAND"
  sort -u -o "$CAND" "$CAND"
  echo "$size" > "$OFF"
fi
exec /usr/bin/perl -MCwd=abs_path -MFile::Find -e '
  my ($start, $cwd, $repo, $cand) = @ARGV;
  my $home = $ENV{HOME};
  my $atlas = abs_path("$home/MEGA/Documents/atlas") // "$home/MEGA/Documents/atlas";
  my $week = time - 7 * 86400;
  my (@bases, %at, %todo, %doc);
  push @bases, $cwd, "$home/MEGA/Documents/atlas";
  push @bases, $repo if $repo ne "-";
  # A doc named at $t: changed when it changed within 15 minutes after a call that named it,
  # and so does its .md/.html twin (md-render names the .md and writes the .html).
  # $t undef is the folder walk: changed since the start.
  sub note { my ($f, $t) = @_; my $p = abs_path($f) or return;
    return unless index($p, "$atlas/") == 0 && $p !~ m{/evidence/} && $p !~ m{/index\.html$};
    for my $q ($p, ($p =~ /\.md$/ ? $p =~ s/\.md$/.html/r : $p =~ s/\.html$/.md/r)) {
      my $m = (stat $q)[9] or next;
      my $d = $doc{$q} //= { m => $m, last => 0, n => 0, changed => 0 };
      if (!defined $t) { $d->{changed} = 1 if $m >= $start; next }
      next if $q ne $p && !($m >= $t - 60 && $m <= $t + 900);
      $d->{changed} = 1 if $m >= $start && $m >= $t - 60 && $m <= $t + 900;
      $d->{n}++ if $q eq $p;
      $d->{last} = $t if $t > $d->{last}; } }
  if (open my $fh, "<", $cand) { while (<$fh>) { chomp; my ($t, $x) = split /\t/, $_, 2; next unless defined $x;
    if ($x =~ /^\@todo:(\d+)$/) { my $o = $todo{$1} //= [0, 0]; $o->[1]++; $o->[0] = $t if $t > $o->[0]; next }
    my $cd = $x =~ s/^cd +//; $x =~ s{^~/}{$home/};
    # Published links: https://atlas.hadadus.me/r/<repo>/<path> is repos/<repo>/<path>.
    $x =~ s{^//atlas\.hadadus\.me/r/}{$atlas/repos/};
    if ($cd) { push @bases, $x if $x =~ m{^/} } else { push @{$at{$x}}, $t } } }
  # "atlas/x.md" was relative to some repo whose atlas link we may not have seen.
  my @repos = glob("$atlas/repos/*");
  for my $x (keys %at) { my %done; for my $t (@{$at{$x}}) {
    my @hits = $x =~ m{^/} ? ($x) : (map("$_/$x", @bases), $x =~ m{^atlas/(.+)} ? map("$_/$1", @repos) : ());
    # One name resolves to one file: the first base where it exists.
    my ($f) = grep { -f } @hits; note($f, $t) if $f } }
  if ($repo ne "-") { find({ no_chdir => 1, wanted => sub {
    if (-d && ($_ =~ m{/evidence$} || ($File::Find::name =~ tr{/}{}) - ($repo =~ tr{/}{}) > 3)) { $File::Find::prune = 1; return }
    note($_) if /\.(md|html)$/ && -f } }, $repo) }
  for my $p (keys %doc) { my $d = $doc{$p};
    if ($d->{changed}) { print join("\t", "C", $d->{m}, $d->{last} || $d->{m}, $d->{n}, $p), "\n" }
    elsif ($d->{last} >= $week) { print join("\t", "R", $d->{m}, $d->{last}, $d->{n}, $p), "\n" } }
  for my $id (keys %todo) { print join("\t", "T", $id, @{$todo{$id}}), "\n" }
' "$START" "$CWD" "$REPO" "$CAND"
